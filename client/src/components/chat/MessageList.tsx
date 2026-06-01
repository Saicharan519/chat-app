import React, { useEffect, useRef } from 'react';
import { useMessages } from '@/features/messages/api';
import type { Message } from '@/features/messages/api';
import { useRoomMembers, useRooms } from '@/features/rooms/api';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { Loader2 } from 'lucide-react';

interface MessageListProps {
  roomId: string;
  currentUserId: string;
  onEditMessage?: (message: Message) => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  roomId,
  currentUserId,
  onEditMessage,
}) => {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useMessages(roomId);

  const { data: membersData } = useRoomMembers(roomId);
  const { data: rooms } = useRooms();

  const containerRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastLengthRef = useRef(0);
  const lastRoomIdRef = useRef<string | null>(null);

  const room = rooms?.find((r) => r.id === roomId);

  // Flatten messages (API returns pages newest first, so we reverse to render oldest at top, newest at bottom)
  const messages = React.useMemo(() => {
    const flat = data?.pages.flatMap((p) => p.messages) ?? [];
    return [...flat].reverse();
  }, [data]);

  // Handle room change scroll resetting
  useEffect(() => {
    if (lastRoomIdRef.current !== roomId) {
      lastLengthRef.current = 0;
      lastRoomIdRef.current = roomId;
      // Immediate scroll to bottom on room change
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      }, 50);
    }
  }, [roomId]);

  // Scroll to bottom logic on new messages
  useEffect(() => {
    const container = containerRef.current;
    if (!container || messages.length === 0) return;

    const scrollHeight = container.scrollHeight;
    const scrollTop = container.scrollTop;
    const clientHeight = container.clientHeight;

    // Check if user is already near bottom (within 150px)
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;

    // Scroll to bottom if user is near bottom, or if this is the first load of messages
    if (isNearBottom || lastLengthRef.current === 0) {
      bottomRef.current?.scrollIntoView({
        behavior: lastLengthRef.current === 0 ? 'auto' : 'smooth',
      });
    }

    lastLengthRef.current = messages.length;
  }, [messages.length]);

  // Setup intersection observer for infinite scroll at the top
  useEffect(() => {
    const sentinel = topRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => {
      observer.unobserve(sentinel);
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Get sender name for a message
  const getSenderName = (message: Message) => {
    if (message.sender_id === currentUserId) return 'You';

    // 1. Try to find in members list (groups or DMs)
    const member = membersData?.members.find((m) => m.id === message.sender_id);
    if (member) return member.username;

    // 2. Try to fall back to direct chat room other member
    if (room?.type === 'direct' && room.other_member?.id === message.sender_id) {
      return room.other_member.username;
    }

    return 'Group Member';
  };

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-500">
        <Loader2 className="w-8 h-8 animate-spin text-accent-violet mb-2" />
        <span className="text-sm select-none">Loading messages...</span>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-500 p-8 select-none">
        <span className="text-2xl mb-2">👋</span>
        <p className="text-sm">No messages yet. Say hello!</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto px-4 py-3 space-y-1 scrollbar-thin scrollbar-thumb-white/5"
      style={{ overflowAnchor: 'none' }}
    >
      {/* Top Sentinel for infinite query */}
      <div ref={topRef} className="h-2 w-full" />

      {isFetchingNextPage && (
        <div className="flex justify-center py-2 text-zinc-500 text-xs select-none">
          <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
          <span>Loading older messages...</span>
        </div>
      )}

      {messages.map((message, i) => {
        const isMine = message.sender_id === currentUserId;
        const senderName = getSenderName(message);

        // Grouping: hide avatar/name if previous message was from the same sender
        const prevMessage = messages[i - 1];
        const showAvatar =
          !prevMessage ||
          prevMessage.sender_id !== message.sender_id ||
          prevMessage.type === 'system';

        return (
          <MessageBubble
            key={message.id}
            message={message}
            isMine={isMine}
            senderName={senderName}
            showAvatar={showAvatar}
            onEdit={onEditMessage}
          />
        );
      })}

      {/* Bottom Sentinel — overflow-anchor: auto pulls scroll here on new messages */}
      <div ref={bottomRef} className="h-2 w-full" style={{ overflowAnchor: 'auto' }} />
    </div>
  );
};
