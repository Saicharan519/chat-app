import React, { useState } from 'react';
import { useSearchUsers } from '@/features/users/api';
import { useCreateRoom } from '@/features/rooms/api';
import { useChatStore } from '@/stores/chatStore';
import { Search, Loader2, UserPlus, X } from 'lucide-react';

export const UserSearch: React.FC = () => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const { data: users, isLoading } = useSearchUsers(query);
  const createRoomMutation = useCreateRoom();
  const { setActiveRoomId } = useChatStore();

  const handleSelectUser = async (userId: string) => {
    try {
      const newRoom = await createRoomMutation.mutateAsync({
        type: 'direct',
        memberIds: [userId],
      });
      setActiveRoomId(newRoom.id);
      setQuery('');
      setIsOpen(false);
    } catch (error) {
      console.error('Failed to create/fetch room:', error);
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value.trim().length > 0) {
              setIsOpen(true);
            }
          }}
          placeholder="Search users to chat..."
          className="w-full glass-input pl-10 pr-10 py-2.5 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-accent-violet transition-all duration-200"
        />
        <Search className="absolute left-3.5 top-3 w-4 h-4 text-zinc-500" />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setIsOpen(false);
            }}
            className="absolute right-3.5 top-3 text-zinc-500 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {isOpen && query.trim().length > 0 && (
        <div className="absolute left-0 right-0 mt-2 p-2 rounded-2xl glass-panel border border-white/10 shadow-2xl z-50 max-h-60 overflow-y-auto animate-slide-up">
          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-zinc-500 text-xs font-semibold gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-accent-violet" />
              Searching database...
            </div>
          ) : users && users.length > 0 ? (
            <div className="space-y-1">
              {users.map((user) => (
                <button
                  key={user.id}
                  onClick={() => handleSelectUser(user.id)}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-white/5 transition-all text-left group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-accent-violet/10 border border-accent-violet/20 flex items-center justify-center text-accent-violet font-semibold text-xs">
                      {user.username.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white group-hover:text-accent-violet transition-colors">
                        {user.username}
                      </p>
                      <p className="text-[10px] text-zinc-500">{user.email}</p>
                    </div>
                  </div>
                  <UserPlus className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors" />
                </button>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-zinc-500 text-xs font-semibold">
              No users found matching "{query}"
            </div>
          )}
        </div>
      )}
    </div>
  );
};
