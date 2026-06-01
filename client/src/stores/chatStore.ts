import { create } from 'zustand';

interface ChatState {
  activeRoomId: string | null;
  typing: Record<string, Record<string, boolean>>; // roomId -> { userId -> isTyping }
  presence: Record<string, 'online' | 'offline'>;  // userId -> status
  unreadCounts: Record<string, number>;             // roomId -> count
  isAiAssistantOpen: boolean;
  isSummarizerOpen: boolean;
  setActiveRoomId: (roomId: string | null) => void;
  setTyping: (roomId: string, userId: string, isTyping: boolean) => void;
  setPresence: (userId: string, status: 'online' | 'offline') => void;
  setUnreadCount: (roomId: string, count: number) => void;
  incrementUnread: (roomId: string) => void;
  clearUnread: (roomId: string) => void;
  setAiAssistantOpen: (isOpen: boolean) => void;
  setSummarizerOpen: (isOpen: boolean) => void;
  resetChatStore: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeRoomId: null,
  typing: {},
  presence: {},
  unreadCounts: {},
  isAiAssistantOpen: false,
  isSummarizerOpen: false,

  setActiveRoomId: (roomId) => set({ activeRoomId: roomId }),

  setTyping: (roomId, userId, isTyping) =>
    set((state) => {
      const roomTyping = { ...(state.typing[roomId] || {}) };
      if (isTyping) {
        roomTyping[userId] = true;
      } else {
        delete roomTyping[userId];
      }
      return {
        typing: {
          ...state.typing,
          [roomId]: roomTyping,
        },
      };
    }),

  setPresence: (userId, status) =>
    set((state) => ({
      presence: {
        ...state.presence,
        [userId]: status,
      },
    })),

  setUnreadCount: (roomId, count) =>
    set((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [roomId]: count,
      },
    })),

  incrementUnread: (roomId) =>
    set((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [roomId]: (state.unreadCounts[roomId] || 0) + 1,
      },
    })),

  clearUnread: (roomId) =>
    set((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [roomId]: 0,
      },
    })),

  setAiAssistantOpen: (isOpen) => set({ isAiAssistantOpen: isOpen }),
  setSummarizerOpen: (isOpen) => set({ isSummarizerOpen: isOpen }),

  resetChatStore: () =>
    set({
      activeRoomId: null,
      typing: {},
      presence: {},
      unreadCounts: {},
      isAiAssistantOpen: false,
      isSummarizerOpen: false,
    }),
}));
