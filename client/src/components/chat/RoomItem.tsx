import React, { useState, useRef, useEffect } from 'react';
import { MoreVertical, Trash2, Loader2, Users } from 'lucide-react';
import type { Room } from '@/features/rooms/api';
import { useDeleteRoom } from '@/features/rooms/api';
import { useChatStore } from '@/stores/chatStore';
import { Avatar } from '@/components/ui/Avatar';

interface RoomItemProps {
  room: Room;
  isActive: boolean;
  onClick: () => void;
}

export const RoomItem: React.FC<RoomItemProps> = ({ room, isActive, onClick }) => {
  const { presence, unreadCounts, activeRoomId, setActiveRoomId } = useChatStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const deleteRoom = useDeleteRoom();

  const isDirect = room.type === 'direct';
  const otherMember = room.other_member;

  const displayName = isDirect
    ? otherMember?.username ?? 'Direct Message'
    : room.name ?? 'Group Chat';

  const isOnline = isDirect && otherMember
    ? presence[otherMember.id] === 'online'
    : false;

  const unreadCount = unreadCounts[room.id] || 0;

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const handleDelete = async () => {
    try {
      await deleteRoom.mutateAsync(room.id);
      if (activeRoomId === room.id) {
        setActiveRoomId(null);
      }
      setConfirmOpen(false);
      setMenuOpen(false);
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Failed to delete conversation';
      alert(msg);
    }
  };

  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 text-left cursor-pointer border outline-none select-none ${
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
              {/* Reserved space for the kebab so unread badges don't jump on hover */}
              <span className="w-5 h-5" aria-hidden />
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

      {/* Kebab menu (overlay, doesn't intercept the row click) */}
      <div ref={menuRef} className="absolute top-2.5 right-2.5 z-10">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className={`w-6 h-6 rounded-md flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer ${
            menuOpen ? 'opacity-100 bg-white/10' : 'opacity-0 group-hover:opacity-100'
          }`}
          title="More options"
          aria-label="Room options"
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </button>

        {menuOpen && (
          <div className="absolute top-7 right-0 w-44 border border-white/10 rounded-lg shadow-2xl bg-zinc-950 overflow-hidden animate-fade-in">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmOpen(true);
                setMenuOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="font-semibold">Delete conversation</span>
            </button>
          </div>
        )}
      </div>

      {/* Confirmation modal */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => !deleteRoom.isPending && setConfirmOpen(false)}
        >
          <div
            className="w-full max-w-sm glass-panel border border-white/10 rounded-2xl shadow-2xl bg-zinc-900/95 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
                <Trash2 className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-white">Delete conversation?</h3>
                <p className="text-xs text-zinc-500 truncate">
                  {displayName}
                </p>
              </div>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed mb-5">
              This removes the conversation from your inbox.
              {isDirect
                ? ' The other person will still see your messages on their side.'
                : ' You will be removed from this group.'}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={deleteRoom.isPending}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-zinc-300 hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteRoom.isPending}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/90 text-white hover:bg-rose-500 transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
              >
                {deleteRoom.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
