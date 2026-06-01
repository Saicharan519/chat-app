import React, { useState, useRef, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { MoreVertical, Edit2, Trash2, Paperclip, Download } from 'lucide-react';
import { useDeleteMessage } from '@/features/messages/api';
import type { Message } from '@/features/messages/api';
import { Avatar } from '@/components/ui/Avatar';

interface MessageBubbleProps {
  message: Message;
  isMine: boolean;
  senderName: string;
  showAvatar: boolean;
  onEdit?: (message: Message) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isMine,
  senderName,
  showAvatar,
  onEdit,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const deleteMessageMutation = useDeleteMessage();

  // Close context menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMenu]);

  // System Message
  if (message.type === 'system') {
    return (
      <div className="flex justify-center my-2 w-full select-none">
        <span className="text-xs text-zinc-500 italic bg-white/5 px-3 py-1 rounded-full border border-white/5">
          {message.content}
        </span>
      </div>
    );
  }

  // Deleted Message
  if (message.deleted_at !== null) {
    return (
      <div
        className={`flex gap-2 mb-2 message-bubble-wrapper ${
          isMine ? 'flex-row-reverse' : 'flex-row'
        } items-end`}
      >
        {!isMine && (
          <div className="w-9 h-9 flex-shrink-0">
            {showAvatar && <Avatar name={senderName} size="md" />}
          </div>
        )}
        <div
          className={`px-4 py-2.5 rounded-[18px] text-zinc-500 italic text-sm border border-dashed border-white/5 bg-transparent max-w-[70%] ${
            isMine ? 'rounded-tr-[4px]' : 'rounded-tl-[4px]'
          }`}
        >
          Message deleted
        </div>
      </div>
    );
  }

  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this message?')) {
      deleteMessageMutation.mutate({ messageId: message.id });
      setShowMenu(false);
    }
  };

  const handleEdit = () => {
    if (onEdit) {
      onEdit(message);
    }
    setShowMenu(false);
  };

  const safeContent = DOMPurify.sanitize(message.content ?? '');

  return (
    <div
      className={`flex gap-2 mb-1 message-bubble-wrapper relative group ${
        isMine ? 'flex-row-reverse' : 'flex-row'
      } items-end`}
    >
      {/* Avatar on left for other user */}
      {!isMine && (
        <div className="w-9 h-9 flex-shrink-0">
          {showAvatar && <Avatar name={senderName} size="md" />}
        </div>
      )}

      {/* Bubble Container */}
      <div
        className={`flex flex-col relative max-w-[70%] ${
          isMine ? 'items-end' : 'items-start'
        }`}
      >
        {!isMine && showAvatar && (
          <span className="text-[11px] text-zinc-500 ml-2 mb-0.5 select-none font-medium">
            {senderName}
          </span>
        )}

        <div
          className={`relative px-4 py-2.5 rounded-[18px] transition-all duration-150 ${
            isMine
              ? 'bg-accent-violet text-white rounded-tr-[4px]'
              : 'bg-[#1c1c21] text-zinc-100 rounded-tl-[4px] border border-white/5'
          }`}
        >
          {/* Text message */}
          {message.type === 'text' && (
            <p
              className="text-sm whitespace-pre-wrap break-words"
              dangerouslySetInnerHTML={{ __html: safeContent }}
            />
          )}

          {/* Image message */}
          {message.type === 'image' && message.file_url && (
            <img
              src={message.file_url}
              alt={message.file_name ?? 'Uploaded image'}
              className="max-h-64 rounded-xl object-cover cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => window.open(message.file_url!, '_blank')}
            />
          )}

          {/* File message */}
          {message.type === 'file' && message.file_url && (
            <div className="flex items-center gap-3 bg-black/20 p-2.5 rounded-xl border border-white/5 min-w-[200px] max-w-full">
              <div className="p-2 rounded-lg bg-white/10 text-white flex-shrink-0">
                <Paperclip className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white truncate">
                  {message.file_name}
                </p>
                <p className="text-[10px] text-zinc-400">
                  {formatBytes(message.file_size)}
                </p>
              </div>
              <a
                href={message.file_url}
                download={message.file_name ?? 'file'}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-300 hover:text-white transition-colors"
                title="Download file"
              >
                <Download className="w-4 h-4" />
              </a>
            </div>
          )}
        </div>

        {/* Info row: edited and time */}
        <div className="flex items-center gap-1.5 mt-1 select-none px-1">
          {message.edited_at && (
            <span className="text-[10px] text-zinc-500 italic">edited</span>
          )}
          <span className="text-[10px] text-zinc-500">
            {formatTime(message.created_at)}
          </span>
        </div>
      </div>

      {/* Message Actions (Edit/Delete menu) - Only if mine and hover/right-click */}
      {isMine && (
        <div className="message-actions self-center relative flex items-center justify-center">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Message options"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {showMenu && (
            <div
              ref={menuRef}
              className="absolute bottom-8 right-0 w-32 rounded-xl border border-white/5 bg-[#131316] p-1 shadow-xl z-30"
            >
              {message.type === 'text' && onEdit && (
                <button
                  onClick={handleEdit}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs text-zinc-300 hover:bg-white/5 hover:text-white transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
              )}
              <button
                onClick={handleDelete}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs text-accent-pink hover:bg-accent-pink/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}
