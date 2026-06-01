import React from 'react';
import { useRooms } from '@/features/rooms/api';
import { RoomItem } from '@/components/chat/RoomItem';
import { useChatStore } from '@/stores/chatStore';

export const RoomList: React.FC = () => {
  const { data: rooms, isLoading } = useRooms();
  const { activeRoomId, setActiveRoomId } = useChatStore();

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-8 text-zinc-500 text-sm font-medium">
        <span className="animate-pulse">Loading conversations...</span>
      </div>
    );
  }

  if (!rooms || rooms.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none">
        <span className="text-2xl mb-2">💬</span>
        <p className="text-sm text-zinc-400 font-medium">No active chats</p>
        <p className="text-xs text-zinc-500 mt-1 max-w-[180px] mx-auto">
          Search for a user in the box above to start a conversation.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-white/5 scroll-smooth">
      {rooms.map((room) => (
        <RoomItem
          key={room.id}
          room={room}
          isActive={room.id === activeRoomId}
          onClick={() => setActiveRoomId(room.id)}
        />
      ))}
    </div>
  );
};
