import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Sparkles, Loader2, FileText, Image as ImageIcon } from 'lucide-react';
import { useSemanticSearch } from '@/features/messages/api';
import type { SemanticSearchResult } from '@/features/messages/api';

interface SemanticSearchModalProps {
  roomId: string;
  isOpen: boolean;
  onClose: () => void;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const formatTime = (iso: string): string => {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export const SemanticSearchModal: React.FC<SemanticSearchModalProps> = ({
  roomId,
  isOpen,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 350);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isFetching, isError, error } = useSemanticSearch(roomId, debouncedQuery);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const results = data?.results ?? [];
  const showLoading = isFetching && debouncedQuery.trim().length >= 2;
  const showEmpty =
    !isFetching && debouncedQuery.trim().length >= 2 && results.length === 0;
  const showPrompt = debouncedQuery.trim().length < 2;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl glass-panel border border-white/10 rounded-2xl shadow-2xl bg-zinc-900/95 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header / search input */}
        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-3">
          <Sparkles className="w-4 h-4 text-accent-violet shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by meaning — try 'deadline' or 'next meeting'..."
            className="flex-1 bg-transparent text-sm text-white placeholder:text-zinc-500 focus:outline-none"
          />
          {isFetching && <Loader2 className="w-4 h-4 animate-spin text-accent-violet shrink-0" />}
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white transition-colors cursor-pointer shrink-0"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto scrollbar-none">
          {showPrompt && (
            <div className="px-5 py-10 text-center text-zinc-500">
              <Search className="w-8 h-8 mx-auto mb-3 text-zinc-600" />
              <p className="text-sm font-semibold text-zinc-300">Semantic search</p>
              <p className="text-xs mt-1 max-w-md mx-auto leading-relaxed">
                This isn't keyword search — find messages by what they mean.
                Search "deadline" and it'll find messages about due dates even
                if the word never appears.
              </p>
            </div>
          )}

          {showLoading && results.length === 0 && (
            <div className="px-5 py-10 text-center text-zinc-500">
              <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin text-accent-violet" />
              <p className="text-xs">Searching by meaning…</p>
            </div>
          )}

          {isError && (
            <div className="px-5 py-6 text-center">
              <p className="text-xs text-rose-400">
                {error?.message || 'Search failed. Try again.'}
              </p>
            </div>
          )}

          {showEmpty && (
            <div className="px-5 py-10 text-center text-zinc-500">
              <p className="text-sm font-semibold text-zinc-300">No matches</p>
              <p className="text-xs mt-1">
                Try different wording, or send more messages so the AI has more to index.
              </p>
            </div>
          )}

          {results.length > 0 && (
            <ul className="py-2">
              {results.map((r) => (
                <SearchResultRow key={r.id} result={r} />
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-white/5 bg-white/2 flex items-center justify-between text-[10px] text-zinc-500">
          <span>
            {results.length > 0
              ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}`
              : 'Powered by Gemini embeddings + pgvector'}
          </span>
          <span className="font-mono">esc to close</span>
        </div>
      </div>
    </div>
  );
};

const SearchResultRow: React.FC<{ result: SemanticSearchResult }> = ({ result }) => {
  const isFile = result.type === 'file' || result.type === 'image';
  const similarityPct = Math.round(result.similarity * 100);
  const preview =
    result.content ??
    (result.file_name ? `📎 ${result.file_name}` : 'Attachment');

  return (
    <li className="px-5 py-3 hover:bg-white/5 transition-colors border-b border-white/5 last:border-b-0">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-6 h-6 rounded-full bg-gradient-to-tr from-accent-violet to-accent-pink flex items-center justify-center text-[10px] font-bold text-white shrink-0">
            {result.sender_username.charAt(0).toUpperCase()}
          </span>
          <span className="text-xs font-semibold text-zinc-200 truncate">
            {result.sender_username}
          </span>
          <span className="text-[10px] text-zinc-500 shrink-0">
            · {formatTime(result.created_at)}
          </span>
        </div>
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-accent-violet/15 text-accent-violet border border-accent-violet/20 shrink-0"
          title={`Cosine similarity: ${result.similarity}`}
        >
          {similarityPct}%
        </span>
      </div>
      <p className="text-xs text-zinc-300 leading-relaxed line-clamp-3 flex items-start gap-1.5">
        {isFile && (
          <span className="text-zinc-500 shrink-0 mt-0.5">
            {result.type === 'image' ? (
              <ImageIcon className="w-3 h-3" />
            ) : (
              <FileText className="w-3 h-3" />
            )}
          </span>
        )}
        <span>{preview}</span>
      </p>
    </li>
  );
};
