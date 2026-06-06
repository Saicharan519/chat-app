import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket, initSocket, disconnectSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/authStore';
import { useChatStore } from '@/stores/chatStore';
import { tokenStore } from '@/lib/tokenStore';
import type { Message, MessagesResponse } from '@/features/messages/api';
import type { InfiniteData } from '@tanstack/react-query';

export function useSocket() {
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuthStore();
  const { activeRoomId, setTyping, setPresence, incrementUnread, clearUnread } = useChatStore();
  const activeRoomIdRef = useRef<string | null>(activeRoomId);

  // Keep activeRoomId ref updated so socket listeners can read the latest value
  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      disconnectSocket();
      return;
    }

    const token = tokenStore.getToken();
    if (!token) return;

    const socket = initSocket(token);
    socket.connect();

    socket.on('connect', () => {
      console.log('Socket.io connected successfully');
      // Broadcast presence immediately — don't wait up to 20s for the first heartbeat interval
      socket.emit('presence:heartbeat');
    });

    socket.on('presence:sync', (snapshot: Record<string, 'online' | 'offline'>) => {
      Object.entries(snapshot).forEach(([uid, status]) => setPresence(uid, status));
    });

    socket.on('presence:update', ({ userId, status }: { userId: string; status: 'online' | 'offline' }) => {
      setPresence(userId, status);
    });

    socket.on('typing:update', ({ roomId, userId, isTyping }: { roomId: string; userId: string; isTyping: boolean }) => {
      setTyping(roomId, userId, isTyping);
    });

    socket.on('message:new', (message: Message) => {
      const currentActiveRoomId = activeRoomIdRef.current;

      // Update TanStack Query cache for messages in this room
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(
        ['messages', message.room_id],
        (oldData) => {
          if (!oldData) return oldData;
          const pages = [...oldData.pages];
          if (pages.length > 0) {
            // Check if message is already in page to avoid duplicates
            const isDuplicate = pages.some(page => page.messages.some(m => m.id === message.id));
            if (!isDuplicate) {
              pages[0] = {
                ...pages[0],
                messages: [message, ...pages[0].messages],
              };
            }
          }
          return {
            ...oldData,
            pages,
          };
        }
      );

      if (message.room_id === currentActiveRoomId) {
        // Mark message as read
        socket.emit('message:read', { roomId: currentActiveRoomId, messageId: message.id });
      } else {
        // Increment unread count in Zustand
        incrementUnread(message.room_id);
      }

      // Invalidate rooms query so room list (with last message) updates
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
    });

    socket.on('room:replay', ({ messages, has_gap, roomId }: { messages: Message[]; has_gap: boolean; roomId: string }) => {
      console.log(`Received ${messages.length} replayed messages for room ${roomId}`);

      if (has_gap) {
        // If there's a gap (more than 50 messages missed), invalidate to trigger standard REST fetch
        queryClient.invalidateQueries({ queryKey: ['messages', roomId] });
      } else {
        // Merge replayed messages into cache
        queryClient.setQueryData<InfiniteData<MessagesResponse>>(
          ['messages', roomId],
          (oldData) => {
            if (!oldData) {
              // If no old data, build a fresh initial page
              return {
                pages: [{ messages, nextCursor: null }],
                pageParams: [null],
              };
            }
            const pages = [...oldData.pages];
            if (pages.length > 0) {
              // Merge replayed messages, avoiding duplicates
              const existingIds = new Set(pages.flatMap(page => page.messages.map(m => m.id)));
              const uniqueNew = messages.filter(m => !existingIds.has(m.id));
              pages[0] = {
                ...pages[0],
                messages: [...uniqueNew, ...pages[0].messages],
              };
            }
            return {
              ...oldData,
              pages,
            };
          }
        );
      }
    });

    socket.on('message:read', ({ roomId }: { roomId: string; messageId: string; userId: string }) => {
      // Invalidate messages query or update cache as needed
      queryClient.invalidateQueries({ queryKey: ['messages', roomId] });
    });

    socket.on('message:update', (updatedMessage: Message) => {
      queryClient.setQueryData<InfiniteData<MessagesResponse>>(
        ['messages', updatedMessage.room_id],
        (oldData) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            pages: oldData.pages.map((page) => ({
              ...page,
              messages: page.messages.map((m) =>
                m.id === updatedMessage.id ? updatedMessage : m
              ),
            })),
          };
        }
      );
    });

    socket.on('error', (err: any) => {
      console.error('Socket error received:', err);
    });

    // Start presence heartbeat interval
    const heartbeatInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit('presence:heartbeat');
      }
    }, 20000);

    return () => {
      clearInterval(heartbeatInterval);
      disconnectSocket();
    };
  }, [isAuthenticated, user, setPresence, setTyping, incrementUnread, queryClient]);

  // Handle active room change: join room and emit heartbeat / read receipt
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !socket.connected || !activeRoomId) return;

    // Join room
    socket.emit('room:join', { roomId: activeRoomId });
    clearUnread(activeRoomId);
  }, [activeRoomId, clearUnread]);
}
