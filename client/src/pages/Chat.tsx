import React from 'react';
import { MessageSquare } from 'lucide-react';
import { useSocket } from '@/hooks/useSocket';
import { useChatStore } from '@/stores/chatStore';
import { Sidebar } from '@/components/chat/Sidebar';
import { ChatWindow } from '@/components/chat/ChatWindow';

export const Chat: React.FC = () => {
  useSocket();

  const { activeRoomId } = useChatStore();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#09090b]">
      <div className="pointer-events-none absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-accent-violet/5 blur-[140px]" />
      <div className="pointer-events-none absolute bottom-0 left-0 w-[600px] h-[600px] rounded-full bg-accent-blue/5 blur-[140px]" />

      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0 relative">
        {activeRoomId ? (
          <ChatWindow roomId={activeRoomId} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="w-20 h-20 rounded-3xl bg-[#131316] border border-white/5 flex items-center justify-center relative">
              <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-accent-violet to-accent-pink opacity-20 blur-md" />
              <MessageSquare className="w-10 h-10 text-accent-violet relative" />
            </div>
            <h2 className="font-display text-xl font-bold text-white">Select a conversation</h2>
            <p className="text-zinc-500 text-sm max-w-xs">
              Choose a room from the sidebar or start a new conversation.
            </p>
          </div>
        )}
      </main>
    </div>
  );
};
