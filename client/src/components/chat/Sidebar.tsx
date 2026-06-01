import React, { useState } from 'react';
import { MessageSquare, Plus, LogOut } from 'lucide-react';
import { useRooms } from '@/features/rooms/api';
import { useChatStore } from '@/stores/chatStore';
import { useAuthStore } from '@/stores/authStore';
import { RoomItem } from '@/components/chat/RoomItem';
import { NewChatModal } from '@/components/chat/NewChatModal';

export const Sidebar: React.FC = () => {
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);

  const { data: rooms, isLoading } = useRooms();
  const { activeRoomId, setActiveRoomId } = useChatStore();
  const { user, logout } = useAuthStore();

  return (
    <div className="flex flex-col h-full w-72 glass-panel border-r border-white/5 shrink-0 overflow-hidden select-none">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 shrink-0 flex flex-col gap-3.5">
        {/* Logo row */}
        <div className="flex items-center gap-2 px-1">
          <div className="w-8 h-8 rounded-lg bg-accent-violet/10 border border-accent-violet/20 flex items-center justify-center text-accent-violet">
            <MessageSquare className="w-4.5 h-4.5" />
          </div>
          <span className="font-display font-bold text-white text-base">
            Antigravity Chat
          </span>
        </div>

        {/* User row */}
        {user && (
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl bg-white/5 border border-white/5">
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-accent-violet to-accent-pink flex items-center justify-center font-bold text-white text-xs">
                {user.username ? user.username.charAt(0).toUpperCase() : '?'}
              </div>
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#09090b]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-zinc-100 truncate">
                {user.username}
              </p>
              <p className="text-[10px] text-zinc-500 truncate">
                {user.email}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* New Conversation Button */}
      <div className="px-4 shrink-0">
        <button
          onClick={() => setIsNewChatOpen(true)}
          className="mt-1 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent-violet/10 border border-accent-violet/20 text-accent-violet hover:text-white text-sm font-semibold hover:bg-accent-violet/20 transition-all duration-150 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>New Conversation</span>
        </button>
      </div>

      {/* Rooms List */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 mt-4 space-y-1">
        <span className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 px-3 mb-2">
          Conversations
        </span>

        {isLoading ? (
          <div className="space-y-2 px-2">
            <div className="h-14 rounded-xl bg-white/5 animate-pulse" />
            <div className="h-14 rounded-xl bg-white/5 animate-pulse" />
            <div className="h-14 rounded-xl bg-white/5 animate-pulse" />
          </div>
        ) : !rooms || rooms.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 text-xs px-4">
            No conversations yet
          </div>
        ) : (
          rooms.map((room) => (
            <RoomItem
              key={room.id}
              room={room}
              isActive={room.id === activeRoomId}
              onClick={() => setActiveRoomId(room.id)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-4 pt-3 border-t border-white/5 shrink-0 bg-transparent">
        <button
          onClick={logout}
          className="flex items-center gap-2 text-zinc-500 hover:text-accent-pink text-sm transition-colors cursor-pointer w-full py-1.5 px-2 rounded-lg hover:bg-white/5"
        >
          <LogOut className="w-4 h-4" />
          <span>Log out</span>
        </button>
      </div>

      {/* New Conversation Modal */}
      <NewChatModal
        isOpen={isNewChatOpen}
        onClose={() => setIsNewChatOpen(false)}
      />
    </div>
  );
};
