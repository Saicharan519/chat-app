import React, { useState } from 'react';
import { X, Search, Check, UserPlus } from 'lucide-react';
import { useSearchUsers } from '@/features/users/api';
import type { User } from '@/features/users/api';
import { useCreateRoom } from '@/features/rooms/api';
import { useChatStore } from '@/stores/chatStore';
import { Avatar } from '@/components/ui/Avatar';

interface NewChatModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewChatModal: React.FC<NewChatModalProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [groupName, setGroupName] = useState('');

  const { data: users, isLoading } = useSearchUsers(query);
  const createRoom = useCreateRoom();
  const { setActiveRoomId } = useChatStore();

  if (!isOpen) return null;

  const handleToggleUser = (user: User) => {
    if (selectedUsers.some((u) => u.id === user.id)) {
      setSelectedUsers(selectedUsers.filter((u) => u.id !== user.id));
    } else {
      setSelectedUsers([...selectedUsers, user]);
    }
  };

  const handleCreate = () => {
    if (selectedUsers.length === 0) return;
    
    if (selectedUsers.length === 1) {
      createRoom.mutate(
        { type: 'direct', memberIds: [selectedUsers[0].id] },
        {
          onSuccess: (room) => {
            setActiveRoomId(room.id);
            handleClose();
          },
        }
      );
    } else {
      createRoom.mutate(
        {
          type: 'group',
          name: groupName.trim() || 'Group Chat',
          memberIds: selectedUsers.map((u) => u.id),
        },
        {
          onSuccess: (room) => {
            setActiveRoomId(room.id);
            handleClose();
          },
        }
      );
    }
  };

  const handleClose = () => {
    setQuery('');
    setSelectedUsers([]);
    setGroupName('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-panel w-full max-w-md rounded-2xl p-6 flex flex-col max-h-[90vh] shadow-2xl relative animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-accent-violet" />
            New Conversation
          </h2>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Input */}
        <div className="relative mb-4 shrink-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search users by username..."
            className="w-full glass-input rounded-xl pl-10 pr-4 py-2.5 text-sm bg-transparent text-white border border-white/10 focus:border-accent-violet focus:outline-none transition-colors"
          />
        </div>

        {/* Selected Users Chips */}
        {selectedUsers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4 max-h-24 overflow-y-auto py-1 shrink-0">
            {selectedUsers.map((user) => (
              <div
                key={user.id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-violet/20 border border-accent-violet/30 text-accent-violet text-xs font-semibold"
              >
                <span>{user.username}</span>
                <button
                  onClick={() => handleToggleUser(user)}
                  className="hover:text-white cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Search Results / Users List */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 mb-4 min-h-[150px]">
          {query.trim().length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-xs text-center p-4">
              <Search className="w-8 h-8 mb-2 text-zinc-600" />
              <span>Search for users to start a conversation.</span>
            </div>
          ) : isLoading ? (
            <div className="h-full flex items-center justify-center text-zinc-500 text-xs animate-pulse">
              Searching users...
            </div>
          ) : !users || users.length === 0 ? (
            <div className="h-full flex items-center justify-center text-zinc-500 text-xs">
              No users found matching "{query}"
            </div>
          ) : (
            users.map((user) => {
              const isSelected = selectedUsers.some((u) => u.id === user.id);
              return (
                <button
                  key={user.id}
                  onClick={() => handleToggleUser(user)}
                  className={`w-full flex items-center justify-between p-3 rounded-xl transition-all duration-150 text-left border cursor-pointer select-none outline-none ${
                    isSelected
                      ? 'bg-accent-violet/10 border-accent-violet/30 text-white'
                      : 'border-transparent hover:bg-white/5 text-zinc-300 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={user.username} size="sm" />
                    <div>
                      <p className="text-sm font-semibold">{user.username}</p>
                      <p className="text-xs text-zinc-500">{user.email}</p>
                    </div>
                  </div>
                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-accent-violet flex items-center justify-center text-white">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Group Name Field (if > 1 user selected) */}
        {selectedUsers.length > 1 && (
          <div className="mb-4 shrink-0 animate-fade-in">
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">
              Group Name (Optional)
            </label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Dream Team"
              className="w-full glass-input rounded-xl px-4 py-2.5 text-sm bg-transparent text-white border border-white/10 focus:border-accent-violet focus:outline-none transition-colors"
            />
          </div>
        )}

        {/* Action Button */}
        <div className="shrink-0 pt-2 border-t border-white/5">
          <button
            onClick={handleCreate}
            disabled={selectedUsers.length === 0 || createRoom.isPending}
            className="w-full py-2.5 rounded-xl bg-accent-violet hover:bg-accent-violet/90 text-white font-semibold shadow-md shadow-accent-violet/20 transition-all duration-150 disabled:opacity-40 disabled:hover:bg-accent-violet cursor-pointer flex items-center justify-center gap-2"
          >
            {createRoom.isPending ? 'Creating...' : selectedUsers.length > 1 ? 'Create Group' : 'Start Chat'}
          </button>
        </div>
      </div>
    </div>
  );
};
