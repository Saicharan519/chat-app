import React, { useState, useRef, useEffect } from 'react';
import { Paperclip, Send, X, Loader2 } from 'lucide-react';
import {
  useSendMessage,
  useEditMessage,
  useUploadFile,
} from '@/features/messages/api';
import type { Message } from '@/features/messages/api';
import { getSocket } from '@/lib/socket';

interface MessageInputProps {
  roomId: string;
  editingMessage?: Message | null;
  onCancelEdit?: () => void;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  roomId,
  editingMessage,
  onCancelEdit,
}) => {
  const [text, setText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sendMessageMutation = useSendMessage();
  const editMessageMutation = useEditMessage();
  const uploadFileMutation = useUploadFile();

  // Load message content when entering edit mode
  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.content ?? '');
      textareaRef.current?.focus();
    } else {
      setText('');
    }
  }, [editingMessage]);

  // Auto-expand textarea height
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    }
  }, [text]);

  const handleTextChange = (val: string) => {
    setText(val);

    // Typing Event Emission
    const socket = getSocket();
    if (socket) {
      socket.emit('typing:start', { roomId });
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('typing:stop', { roomId });
      }, 2500);
    }
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (editingMessage) {
      editMessageMutation.mutate({
        messageId: editingMessage.id,
        content: trimmed,
      });
      onCancelEdit?.();
    } else {
      sendMessageMutation.mutate({
        roomId,
        content: trimmed,
      });
    }

    setText('');

    // Stop typing immediately on send
    const socket = getSocket();
    if (socket) {
      socket.emit('typing:stop', { roomId });
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const checkMagicBytes = (file: File): Promise<{ isValid: boolean; errorMsg?: string }> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = (e) => {
        if (!e.target?.result) {
          resolve({ isValid: false, errorMsg: 'Could not read file headers.' });
          return;
        }
        const arr = new Uint8Array(e.target.result as ArrayBuffer);
        if (arr.length < 2) {
          resolve({ isValid: false, errorMsg: 'File is empty or too small.' });
          return;
        }

        // 1. Block executable formats
        // Windows Executable: MZ (4D 5A)
        const isExe = arr[0] === 0x4d && arr[1] === 0x5a;
        // ELF Executable: \x7F ELF (7F 45 4C 46)
        const isElf =
          arr.length >= 4 &&
          arr[0] === 0x7f &&
          arr[1] === 0x45 &&
          arr[2] === 0x4c &&
          arr[3] === 0x46;

        if (isExe || isElf) {
          resolve({ isValid: false, errorMsg: 'Executable files are strictly prohibited.' });
          return;
        }

        const name = file.name.toLowerCase();
        const type = file.type.toLowerCase();

        // 2. Image validation
        if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(name)) {
          if (arr.length < 4) {
            resolve({ isValid: false, errorMsg: 'Invalid image header.' });
            return;
          }
          // JPEG: FF D8 FF
          const isJpeg = arr[0] === 0xff && arr[1] === 0xd8 && arr[2] === 0xff;
          // PNG: 89 50 4E 47
          const isPng =
            arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4e && arr[3] === 0x47;
          // WebP: RIFF (52 49 46 46) + WEBP (57 45 42 50) at offset 8
          let isWebp = false;
          if (arr.length >= 12) {
            const isRiff =
              arr[0] === 0x52 && arr[1] === 0x49 && arr[2] === 0x46 && arr[3] === 0x46;
            const isWebpSignature =
              arr[8] === 0x57 && arr[9] === 0x45 && arr[10] === 0x42 && arr[11] === 0x50;
            isWebp = isRiff && isWebpSignature;
          }
          // GIF: GIF8 (47 49 46 38)
          const isGif = arr[0] === 0x47 && arr[1] === 0x49 && arr[2] === 0x46 && arr[3] === 0x38;

          if (isJpeg || isPng || isWebp || isGif) {
            resolve({ isValid: true });
          } else {
            resolve({
              isValid: false,
              errorMsg: 'Invalid image format. Must be a valid JPEG, PNG, WebP, or GIF image.',
            });
          }
          return;
        }

        // 3. PDF validation
        if (type === 'application/pdf' || name.endsWith('.pdf')) {
          if (arr.length < 4) {
            resolve({ isValid: false, errorMsg: 'Invalid PDF header.' });
            return;
          }
          // PDF: %PDF (25 50 44 46)
          const isPdf =
            arr[0] === 0x25 && arr[1] === 0x50 && arr[2] === 0x44 && arr[3] === 0x46;
          if (isPdf) {
            resolve({ isValid: true });
          } else {
            resolve({
              isValid: false,
              errorMsg: 'Invalid PDF format. File content does not match PDF signature.',
            });
          }
          return;
        }

        // 4. DOC/DOCX validation
        if (
          type === 'application/msword' ||
          type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          name.endsWith('.doc') ||
          name.endsWith('.docx')
        ) {
          if (arr.length < 4) {
            resolve({ isValid: false, errorMsg: 'Invalid Document header.' });
            return;
          }
          // DOCX / ZIP: PK (50 4B 03 04)
          const isDocx =
            arr[0] === 0x50 && arr[1] === 0x4b && arr[2] === 0x03 && arr[3] === 0x04;
          // DOC / OLE CF: D0 CF 11 E0
          const isDoc =
            arr[0] === 0xd0 && arr[1] === 0xcf && arr[2] === 0x11 && arr[3] === 0xe0;

          if (isDocx || isDoc) {
            resolve({ isValid: true });
          } else {
            resolve({
              isValid: false,
              errorMsg:
                'Invalid document format. File content does not match DOC/DOCX signature.',
            });
          }
          return;
        }

        // Default: Allow if no specific type validation match
        resolve({ isValid: true });
      };
      reader.readAsArrayBuffer(file.slice(0, 12));
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (≤ 25MB)
    const MAX_SIZE = 25 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      alert('File size exceeds the 25MB limit.');
      return;
    }

    // Validate magic bytes
    const { isValid, errorMsg } = await checkMagicBytes(file);
    if (!isValid) {
      alert(errorMsg || 'Invalid file format detected.');
      return;
    }

    setIsUploading(true);
    try {
      await uploadFileMutation.mutateAsync({
        roomId,
        file,
      });
    } catch (err: any) {
      console.error('File upload failed:', err);
      const errMsg = err.response?.data?.error || 'Failed to upload file. Please try again.';
      alert(errMsg);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="glass-panel border-t border-white/5 px-4 py-3 flex flex-col gap-2 relative">
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*,application/pdf,.doc,.docx"
        className="hidden"
      />

      {/* Editing Banner */}
      {editingMessage && (
        <div className="flex items-center justify-between bg-accent-violet/10 border border-accent-violet/20 rounded-lg px-3 py-1.5 text-xs select-none">
          <span className="text-zinc-300">
            Editing message:{' '}
            <span className="font-semibold text-white">
              "{editingMessage.content}"
            </span>
          </span>
          <button
            onClick={onCancelEdit}
            className="flex items-center gap-1 text-accent-pink hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            <span>Cancel</span>
          </button>
        </div>
      )}

      {/* Input Row */}
      <div className="flex items-end gap-2">
        {/* Attachment Button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="w-9 h-9 rounded-xl glass-panel border border-white/5 flex items-center justify-center hover:bg-white/5 hover:text-white text-zinc-400 transition-colors disabled:opacity-40"
          title="Attach file"
        >
          {isUploading ? (
            <Loader2 className="w-4 h-4 animate-spin text-accent-violet" />
          ) : (
            <Paperclip className="w-4 h-4" />
          )}
        </button>

        {/* Text Input Area */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          className="flex-1 glass-input rounded-xl px-4 py-2.5 text-sm resize-none min-h-[44px] max-h-[160px] bg-transparent text-white border border-white/10 focus:border-accent-violet focus:outline-none transition-colors scrollbar-none"
        />

        {/* Send Button */}
        <button
          onClick={handleSend}
          disabled={!text.trim() || isUploading}
          className="w-9 h-9 rounded-xl bg-accent-violet hover:bg-accent-violet/90 text-white flex items-center justify-center transition-colors disabled:opacity-40 disabled:hover:bg-accent-violet"
          title="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
