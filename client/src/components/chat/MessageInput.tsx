import React, { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Paperclip, Send, X, Loader2, Sparkles, Wand2, ChevronUp } from 'lucide-react';
import {
  useSendMessage,
  useEditMessage,
  useUploadFile,
} from '@/features/messages/api';
import type { Message } from '@/features/messages/api';
import {
  useSmartReplies,
  useRefineTone,
  useRefineCustom,
} from '@/features/ai/api';
import { getSocket } from '@/lib/socket';

interface MessageInputProps {
  roomId: string;
  editingMessage?: Message | null;
  onCancelEdit?: () => void;
}

type Tone = 'professional' | 'friendly' | 'empathetic' | 'concise' | 'witty';

const TONES: { value: Tone; label: string; emoji: string }[] = [
  { value: 'professional', label: 'Professional', emoji: '💼' },
  { value: 'friendly', label: 'Friendly', emoji: '😊' },
  { value: 'empathetic', label: 'Empathetic', emoji: '💛' },
  { value: 'concise', label: 'Concise', emoji: '✂️' },
  { value: 'witty', label: 'Witty', emoji: '🎭' },
];

export const MessageInput: React.FC<MessageInputProps> = ({
  roomId,
  editingMessage,
  onCancelEdit,
}) => {
  const [text, setText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [showAiMenu, setShowAiMenu] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const aiMenuRef = useRef<HTMLDivElement>(null);

  const queryClient = useQueryClient();
  const sendMessageMutation = useSendMessage();
  const editMessageMutation = useEditMessage();
  const uploadFileMutation = useUploadFile();
  const refineToneMutation = useRefineTone();
  const refineCustomMutation = useRefineCustom();

  // Smart replies only fetched when input is empty + not editing
  const isInputEmpty = !text.trim();
  const shouldShowSmartReplies = isInputEmpty && !editingMessage;
  const { data: smartRepliesData, isLoading: smartRepliesLoading } = useSmartReplies(
    shouldShowSmartReplies ? roomId : undefined,
    null
  );

  const isAiBusy = refineToneMutation.isPending || refineCustomMutation.isPending;

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

  // Close AI menu on outside click
  useEffect(() => {
    if (!showAiMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (aiMenuRef.current && !aiMenuRef.current.contains(e.target as Node)) {
        setShowAiMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAiMenu]);

  const handleTextChange = (val: string) => {
    setText(val);

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

  const handleSend = (overrideText?: string) => {
    const trimmed = (overrideText ?? text).trim();
    if (!trimmed) return;

    if (editingMessage) {
      editMessageMutation.mutate({
        messageId: editingMessage.id,
        content: trimmed,
      });
      onCancelEdit?.();
    } else {
      sendMessageMutation.mutate(
        { roomId, content: trimmed },
        {
          onSuccess: () => {
            // Refresh smart replies after sending so they reflect the new context
            queryClient.invalidateQueries({ queryKey: ['smart-replies', roomId] });
          },
        }
      );
    }

    setText('');
    setAiError(null);

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

  const handleSmartReplyClick = (reply: string) => {
    handleSend(reply);
  };

  const handleToneRefine = async (tone: Tone) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setShowAiMenu(false);
    setAiError(null);
    try {
      const result = await refineToneMutation.mutateAsync({ text: trimmed, tone });
      setText(result.result);
      textareaRef.current?.focus();
    } catch (err: any) {
      setAiError(err.response?.data?.error || 'Failed to refine. Try again.');
    }
  };

  const handleImprove = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setShowAiMenu(false);
    setAiError(null);
    try {
      const result = await refineCustomMutation.mutateAsync({
        text: trimmed,
        instruction: 'Improve grammar, clarity, and flow. Keep the original meaning and length similar.',
      });
      setText(result.result);
      textareaRef.current?.focus();
    } catch (err: any) {
      setAiError(err.response?.data?.error || 'Failed to improve. Try again.');
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
        const isExe = arr[0] === 0x4d && arr[1] === 0x5a;
        const isElf =
          arr.length >= 4 &&
          arr[0] === 0x7f && arr[1] === 0x45 && arr[2] === 0x4c && arr[3] === 0x46;
        if (isExe || isElf) {
          resolve({ isValid: false, errorMsg: 'Executable files are strictly prohibited.' });
          return;
        }

        const name = file.name.toLowerCase();
        const type = file.type.toLowerCase();

        if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(name)) {
          if (arr.length < 4) {
            resolve({ isValid: false, errorMsg: 'Invalid image header.' });
            return;
          }
          const isJpeg = arr[0] === 0xff && arr[1] === 0xd8 && arr[2] === 0xff;
          const isPng = arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4e && arr[3] === 0x47;
          let isWebp = false;
          if (arr.length >= 12) {
            const isRiff = arr[0] === 0x52 && arr[1] === 0x49 && arr[2] === 0x46 && arr[3] === 0x46;
            const isWebpSignature = arr[8] === 0x57 && arr[9] === 0x45 && arr[10] === 0x42 && arr[11] === 0x50;
            isWebp = isRiff && isWebpSignature;
          }
          const isGif = arr[0] === 0x47 && arr[1] === 0x49 && arr[2] === 0x46 && arr[3] === 0x38;
          resolve(
            isJpeg || isPng || isWebp || isGif
              ? { isValid: true }
              : { isValid: false, errorMsg: 'Invalid image format.' }
          );
          return;
        }

        if (type === 'application/pdf' || name.endsWith('.pdf')) {
          if (arr.length < 4) {
            resolve({ isValid: false, errorMsg: 'Invalid PDF header.' });
            return;
          }
          const isPdf = arr[0] === 0x25 && arr[1] === 0x50 && arr[2] === 0x44 && arr[3] === 0x46;
          resolve(isPdf ? { isValid: true } : { isValid: false, errorMsg: 'Invalid PDF.' });
          return;
        }

        if (
          type === 'application/msword' ||
          type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          name.endsWith('.doc') ||
          name.endsWith('.docx')
        ) {
          if (arr.length < 4) {
            resolve({ isValid: false, errorMsg: 'Invalid document header.' });
            return;
          }
          const isDocx = arr[0] === 0x50 && arr[1] === 0x4b && arr[2] === 0x03 && arr[3] === 0x04;
          const isDoc = arr[0] === 0xd0 && arr[1] === 0xcf && arr[2] === 0x11 && arr[3] === 0xe0;
          resolve(
            isDocx || isDoc
              ? { isValid: true }
              : { isValid: false, errorMsg: 'Invalid document format.' }
          );
          return;
        }

        resolve({ isValid: true });
      };
      reader.readAsArrayBuffer(file.slice(0, 12));
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const MAX_SIZE = 25 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      alert('File size exceeds the 25MB limit.');
      return;
    }

    const { isValid, errorMsg } = await checkMagicBytes(file);
    if (!isValid) {
      alert(errorMsg || 'Invalid file format detected.');
      return;
    }

    setIsUploading(true);
    try {
      await uploadFileMutation.mutateAsync({ roomId, file });
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

  const smartReplies = smartRepliesData?.replies ?? [];

  return (
    <div className="glass-panel border-t border-white/5 px-4 py-3 flex flex-col gap-2 relative">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*,application/pdf,.doc,.docx"
        className="hidden"
      />

      {/* Smart Reply Chips */}
      {shouldShowSmartReplies && (smartReplies.length > 0 || smartRepliesLoading) && (
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-1">
          <Sparkles className="w-3.5 h-3.5 text-accent-violet shrink-0" />
          {smartRepliesLoading && smartReplies.length === 0 ? (
            <div className="flex items-center gap-1.5">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="w-1.5 h-1.5 bg-accent-violet/60 rounded-full animate-bounce"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
          ) : (
            smartReplies.map((reply, i) => (
              <button
                key={i}
                onClick={() => handleSmartReplyClick(reply)}
                disabled={sendMessageMutation.isPending}
                className="shrink-0 px-3 py-1.5 rounded-full text-xs glass-panel border border-accent-violet/20 bg-accent-violet/5 text-zinc-200 hover:bg-accent-violet/15 hover:border-accent-violet/40 transition-colors disabled:opacity-40 cursor-pointer"
                title="Send this reply"
              >
                {reply}
              </button>
            ))
          )}
        </div>
      )}

      {/* AI Error Banner */}
      {aiError && (
        <div className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400">
          <span>{aiError}</span>
          <button
            onClick={() => setAiError(null)}
            className="text-rose-400 hover:text-white"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Editing Banner */}
      {editingMessage && (
        <div className="flex items-center justify-between bg-accent-violet/10 border border-accent-violet/20 rounded-lg px-3 py-1.5 text-xs select-none">
          <span className="text-zinc-300">
            Editing message:{' '}
            <span className="font-semibold text-white">"{editingMessage.content}"</span>
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

        {/* AI Sparkle Button + Menu */}
        <div ref={aiMenuRef} className="relative">
          <button
            onClick={() => setShowAiMenu((s) => !s)}
            disabled={!text.trim() || isAiBusy}
            className="w-9 h-9 rounded-xl glass-panel border border-accent-violet/20 flex items-center justify-center hover:bg-accent-violet/15 hover:border-accent-violet/40 text-accent-violet transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title={text.trim() ? 'AI rewrite' : 'Type a message first'}
          >
            {isAiBusy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
          </button>

          {showAiMenu && (
            <div className="absolute bottom-full left-0 mb-2 w-56 border border-white/10 rounded-xl shadow-2xl shadow-black/60 bg-zinc-950 z-50 overflow-hidden animate-fade-in">
              <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
                  Rewrite with AI
                </span>
                <ChevronUp className="w-3 h-3 text-zinc-600" />
              </div>
              <button
                onClick={handleImprove}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-zinc-200 hover:bg-accent-violet/15 transition-colors border-b border-white/5 cursor-pointer"
              >
                <Wand2 className="w-3.5 h-3.5 text-accent-violet" />
                <span className="font-semibold">Improve Writing</span>
              </button>
              <div className="px-3 pt-2 pb-1">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
                  Tone
                </span>
              </div>
              {TONES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => handleToneRefine(t.value)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-accent-violet/15 hover:text-white transition-colors cursor-pointer"
                >
                  <span className="text-sm">{t.emoji}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Text Input */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isAiBusy ? 'AI is rewriting…' : 'Type a message...'}
          rows={1}
          disabled={isAiBusy}
          className="flex-1 glass-input rounded-xl px-4 py-2.5 text-sm resize-none min-h-[44px] max-h-[160px] bg-transparent text-white border border-white/10 focus:border-accent-violet focus:outline-none transition-colors scrollbar-none disabled:opacity-60"
        />

        {/* Send Button */}
        <button
          onClick={() => handleSend()}
          disabled={!text.trim() || isUploading || isAiBusy}
          className="w-9 h-9 rounded-xl bg-accent-violet hover:bg-accent-violet/90 text-white flex items-center justify-center transition-colors disabled:opacity-40 disabled:hover:bg-accent-violet"
          title="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
