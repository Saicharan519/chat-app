import React, { useState, useEffect, useRef } from 'react';
import { X, Sparkles, Send, Bot, Trash2 } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { streamSse } from '@/features/ai/api';
import type { AssistantMessage } from '@/features/ai/api';
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer';

export const AiAssistantSidebar: React.FC = () => {
  const { isAiAssistantOpen, setAiAssistantOpen } = useChatStore();
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      role: 'assistant',
      content: "Hello! I am your AI Co-pilot. I can help refine your messages, summarize discussions, draft responses, or answer any general questions. What's on your mind?",
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Auto scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  if (!isAiAssistantOpen) return null;

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isStreaming) return;

    setError(null);
    setInputText('');

    const newHistory: AssistantMessage[] = [
      ...messages,
      { role: 'user', content: text },
    ];

    setMessages(newHistory);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Append a placeholder assistant message that we will stream content into
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    let streamedContent = '';

    streamSse(
      '/ai/assistant',
      {
        history: [
          { role: 'system', content: 'You are a helpful, witty, and intelligent AI Assistant integrated inside a real-time collaborative chat room. Keep your replies concise and formatted beautifully with Markdown where appropriate.' },
          ...newHistory,
        ],
      },
      (chunk) => {
        streamedContent += chunk;
        setMessages((prev) => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.content = streamedContent;
          }
          return updated;
        });
      },
      () => {
        setIsStreaming(false);
        abortControllerRef.current = null;
      },
      (err) => {
        console.error('AI assistant stream error:', err);
        setError(err.message || 'Error fetching response from assistant.');
        setIsStreaming(false);
        // Remove the empty or failed message chunk to avoid junk rows
        setMessages((prev) => {
          const updated = [...prev];
          if (updated[updated.length - 1]?.content === '') {
            updated.pop();
          }
          return updated;
        });
      },
      controller.signal
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    if (window.confirm('Are you sure you want to clear your conversation history?')) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setIsStreaming(false);
      setMessages([
        {
          role: 'assistant',
          content: "Hello! I am your AI Co-pilot. I can help refine your messages, summarize discussions, draft responses, or answer any general questions. What's on your mind?",
        },
      ]);
    }
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full sm:w-96 flex flex-col glass-panel border-l border-white/5 shadow-2xl animate-fade-in">
      
      {/* Glow Effects */}
      <div className="pointer-events-none absolute -top-24 -right-24 w-48 h-48 rounded-full bg-accent-violet/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 w-48 h-48 rounded-full bg-accent-pink/10 blur-3xl" />

      {/* Header */}
      <header className="px-5 py-4 border-b border-white/5 bg-white/2 flex items-center justify-between shrink-0 select-none relative">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent-violet/10 border border-accent-violet/20 flex items-center justify-center text-accent-violet">
            <Sparkles className="w-4.5 h-4.5 animate-pulse" />
          </div>
          <div className="flex flex-col">
            <span className="font-display font-bold text-white text-sm">AI Co-pilot</span>
            <span className="text-[10px] text-zinc-500 font-medium">Chat Assistant</span>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          <button
            onClick={handleClear}
            className="p-1.5 rounded-lg hover:bg-rose-500/10 text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
            title="Clear Chat History"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setAiAssistantOpen(false)}
            className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            title="Close Assistant"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>
      </header>

      {/* Message Feed */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 scrollbar-none relative">
        {messages.map((msg, index) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={index}
              className={`flex items-start gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              {!isUser && (
                <div className="w-7 h-7 rounded-lg bg-accent-violet/10 border border-accent-violet/20 flex items-center justify-center text-accent-violet shrink-0 select-none">
                  <Bot className="w-4 h-4" />
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed relative ${
                  isUser
                    ? 'bg-accent-violet text-white font-medium shadow-lg shadow-accent-violet/10'
                    : 'glass-panel bg-white/2 border border-white/5 text-zinc-300'
                }`}
              >
                {isUser ? (
                  <p className="whitespace-pre-line">{msg.content}</p>
                ) : msg.content ? (
                  <MarkdownRenderer content={msg.content} />
                ) : (
                  <div className="flex items-center gap-1 py-1">
                    <span className="w-1.5 h-1.5 bg-accent-violet rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-accent-violet rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-accent-violet rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {error && (
          <div className="p-3.5 rounded-xl border border-rose-500/20 bg-rose-500/5 text-rose-400 text-xs font-semibold text-center select-none">
            {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Section */}
      <div className="p-4 border-t border-white/5 bg-white/2 shrink-0 relative">
        {isStreaming && (
          <button
            onClick={stopGeneration}
            className="absolute -top-10 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900 border border-white/10 text-[10px] text-zinc-400 hover:text-white transition-all cursor-pointer font-semibold shadow-lg"
          >
            <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-ping" />
            Stop Generating
          </button>
        )}

        <div className="flex items-end gap-2">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            rows={1}
            disabled={isStreaming}
            className="flex-1 glass-input rounded-xl px-4 py-2.5 text-xs resize-none min-h-[38px] max-h-[120px] bg-transparent text-white border border-white/10 focus:border-accent-violet focus:outline-none transition-colors disabled:opacity-50 scrollbar-none"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || isStreaming}
            className="w-9 h-9 rounded-xl bg-accent-violet hover:bg-accent-violet/90 text-white flex items-center justify-center transition-colors disabled:opacity-40 disabled:hover:bg-accent-violet cursor-pointer shrink-0"
            title="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
