import React, { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useChatStore } from '@/stores/chatStore';
import { useRooms, useRoomMembers } from '@/features/rooms/api';
import type { Message } from '@/features/messages/api';
import { Avatar } from '@/components/ui/Avatar';
import { MessageList } from '@/components/chat/MessageList';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { MessageInput } from '@/components/chat/MessageInput';
import { AiAssistantSidebar } from '@/components/chat/AiAssistantSidebar';
import { SummarizerModal } from '@/components/chat/SummarizerModal';
import { Users, ArrowLeft, Sparkles, BookOpen } from 'lucide-react';

interface ChatWindowProps {
  roomId: string;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({ roomId }) => {
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);

  const { user } = useAuthStore();
  const { typing, presence, setActiveRoomId, setAiAssistantOpen, setSummarizerOpen } = useChatStore();
  const { data: rooms } = useRooms();
  const { data: membersData } = useRoomMembers(roomId);

  const room = rooms?.find((r) => r.id === roomId);

  // Clear editing state if room changes
  useEffect(() => {
    setEditingMessage(null);
  }, [roomId]);

  // Determine display name and details
  const isDirect = room?.type === 'direct';
  const otherMember = room?.other_member;
  
  const displayName = isDirect
    ? otherMember?.username ?? 'Direct Message'
    : room?.name ?? 'Group Chat';

  const isOnline = isDirect && otherMember
    ? presence[otherMember.id] === 'online'
    : false;

  // Resolve typing names using room members data
  const typingInRoom = typing[roomId] ?? {};
  const typingNames = Object.keys(typingInRoom)
    .filter((uid) => uid !== user?.id)
    .map((uid) => {
      const member = membersData?.members.find((m) => m.id === uid);
      if (member) return member.username;
      if (isDirect && otherMember?.id === uid) return otherMember.username;
      return 'Someone';
    });

  const memberCount = membersData?.members.length ?? 0;

  return (
    <div className="flex flex-col h-full w-full bg-transparent overflow-hidden">
      {/* Header */}
      <header className="glass-panel border-b border-white/5 px-5 py-3.5 flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveRoomId(null)}
            className="md:hidden p-1.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white transition-colors mr-1 cursor-pointer"
            title="Back to conversations"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Avatar
            name={displayName}
            size="md"
            online={isDirect ? isOnline : false}
          />
          <div className="flex flex-col">
            <h1 className="font-display text-sm font-semibold text-white truncate max-w-[150px] sm:max-w-[300px]">
              {displayName}
            </h1>
            {isDirect ? (
              <span className={`text-[10px] ${isOnline ? 'text-emerald-400 font-medium' : 'text-zinc-500'}`}>
                {isOnline ? 'online' : 'offline'}
              </span>
            ) : (
              <span className="text-[10px] text-zinc-500 flex items-center gap-1 font-medium">
                <Users className="w-3 h-3" />
                {memberCount > 0 ? `${memberCount} members` : 'Group'}
              </span>
            )}
          </div>
        </div>

        {/* Right-side AI action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setSummarizerOpen(true)}
            className="p-2 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white transition-colors"
            title="Summarize conversation"
          >
            <BookOpen className="w-4 h-4" />
          </button>
          <button
            onClick={() => setAiAssistantOpen(true)}
            className="p-2 rounded-lg hover:bg-accent-violet/10 text-zinc-400 hover:text-accent-violet transition-colors"
            title="AI Co-pilot"
          >
            <Sparkles className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Message List */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <MessageList
          roomId={roomId}
          currentUserId={user?.id ?? ''}
          onEditMessage={setEditingMessage}
        />
      </div>

      {/* Typing Indicator */}
      <div className="shrink-0 bg-transparent">
        <TypingIndicator names={typingNames} />
      </div>

      {/* Message Input */}
      <div className="shrink-0">
        <MessageInput
          roomId={roomId}
          editingMessage={editingMessage}
          onCancelEdit={() => setEditingMessage(null)}
        />
      </div>

      {/* AI Panels */}
      <AiAssistantSidebar />
      <SummarizerModal roomId={roomId} />
    </div>
  );
};
