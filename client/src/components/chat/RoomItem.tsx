import React from 'react';
import type { Room } from '@/features/rooms/api';
import { useChatStore } from '@/stores/chatStore';
import { Avatar } from '@/components/ui/Avatar';
import { Users } from 'lucide-react';

interface RoomItemProps {
  room: Room;
  isActive: boolean;
  onClick: () => void;
}

export const RoomItem: React.FC<RoomItemProps> = ({ room, isActive, onClick }) => {
  const { presence, unreadCounts } = useChatStore();

  const isDirect = room.type === 'direct';
  const otherMember = room.other_member;

  const displayName = isDirect
    ? otherMember?.username ?? 'Direct Message'
    : room.name ?? 'Group Chat';

  const isOnline = isDirect && otherMember
    ? presence[otherMember.id] === 'online'
    : false;

  const unreadCount = unreadCounts[room.id] || 0;

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 relative text-left cursor-pointer border outline-none select-none ${
        isActive
          ? 'bg-accent-violet/15 border-accent-violet/25 text-white font-semibold'
          : 'hover:bg-white/5 border-transparent text-zinc-400 hover:text-zinc-200'
      }`}
    >
      <Avatar
        name={displayName}
        size="md"
        online={isDirect ? isOnline : false}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm truncate font-medium text-inherit">{displayName}</p>
          <div className="flex items-center gap-1.5 shrink-0">
            {unreadCount > 0 && (
              <span className="text-[10px] bg-accent-violet text-white px-1.5 py-0.5 rounded-full font-bold shadow-sm shadow-accent-violet/30 min-w-[18px] text-center">
                {unreadCount}
              </span>
            )}
            {!isDirect && (
              <span className="text-[10px] bg-white/5 px-2 py-0.5 rounded-full border border-white/5 text-zinc-500 font-medium flex items-center gap-1">
                <Users className="w-2.5 h-2.5" />
                Group
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-zinc-500 truncate mt-0.5">
          {isDirect
            ? isOnline
              ? 'online'
              : 'offline'
            : 'Group Conversation'}
        </p>
      </div>
    </button>
  );
};

