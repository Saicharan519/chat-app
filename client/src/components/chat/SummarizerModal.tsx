import React, { useEffect, useState, useRef } from 'react';
import { X, Sparkles, Copy, Check, RefreshCw } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { streamSse } from '@/features/ai/api';
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer';

interface SummarizerModalProps {
  roomId: string;
}

export const SummarizerModal: React.FC<SummarizerModalProps> = ({ roomId }) => {
  const { isSummarizerOpen, setSummarizerOpen } = useChatStore();
  const [summary, setSummary] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  const abortControllerRef = useRef<AbortController | null>(null);

  const startStreaming = () => {
    // Abort previous stream if active
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    setSummary('');
    setError(null);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    streamSse(
      '/ai/summarize',
      { roomId },
      (chunk) => {
        setSummary((prev) => prev + chunk);
      },
      () => {
        setIsStreaming(false);
      },
      (err) => {
        console.error('SSE summarizer error:', err);
        setError(err.message || 'Failed to generate summary.');
        setIsStreaming(false);
      },
      controller.signal
    );
  };

  useEffect(() => {
    if (isSummarizerOpen && roomId) {
      startStreaming();
    }

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [isSummarizerOpen, roomId]);

  const handleCopy = () => {
    if (!summary) return;
    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isSummarizerOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md transition-opacity"
        onClick={() => setSummarizerOpen(false)}
      />

      {/* Modal Content */}
      <div className="relative w-full max-w-2xl max-h-[80vh] flex flex-col rounded-3xl glass-panel border border-white/10 shadow-2xl overflow-hidden animate-slide-up z-10">
        
        {/* Glow Effects */}
        <div className="pointer-events-none absolute -top-24 -left-24 w-48 h-48 rounded-full bg-accent-violet/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-24 w-48 h-48 rounded-full bg-accent-pink/10 blur-3xl" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/2 select-none relative shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-accent-violet/10 border border-accent-violet/20 text-accent-violet">
              <Sparkles className="w-4 h-4 animate-pulse" />
            </div>
            <h2 className="font-display font-bold text-white text-base">Conversation Summary</h2>
          </div>
          <button
            onClick={() => setSummarizerOpen(false)}
            className="p-1 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 relative min-h-[200px]">
          {error ? (
            <div className="flex flex-col items-center justify-center text-center h-full py-12 gap-3">
              <p className="text-sm text-rose-400 font-medium">{error}</p>
              <button
                onClick={startStreaming}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-semibold text-white transition-all cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
            </div>
          ) : !summary && isStreaming ? (
            <div className="flex flex-col items-center justify-center h-full py-20 gap-3">
              <div className="w-6 h-6 border-2 border-accent-violet/30 border-t-accent-violet rounded-full animate-spin" />
              <p className="text-xs text-zinc-500 font-medium">Analyzing conversation thread...</p>
            </div>
          ) : (
            <div className="space-y-4">
              <MarkdownRenderer content={summary} />
              {isStreaming && (
                <div className="inline-flex items-center gap-1.5 mt-2">
                  <span className="w-1.5 h-1.5 bg-accent-violet rounded-full animate-ping" />
                  <span className="text-xs text-zinc-500 font-medium">Assistant is writing...</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 bg-white/2 flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={handleCopy}
            disabled={!summary}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 hover:text-white transition-all disabled:opacity-40 disabled:hover:bg-white/5 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Summary</span>
              </>
            )}
          </button>
          <button
            onClick={() => setSummarizerOpen(false)}
            className="px-4 py-2 rounded-xl bg-accent-violet hover:bg-accent-violet/90 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
