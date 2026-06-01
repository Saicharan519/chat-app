import React from 'react';
import { Copy, Check } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const [copiedBlockIndex, setCopiedBlockIndex] = React.useState<number | null>(null);

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedBlockIndex(index);
    setTimeout(() => setCopiedBlockIndex(null), 2000);
  };

  // Basic markdown parser converting text to structured nodes
  // Supports block code, inline code, bold, lists, and paragraphs.
  const parseMarkdown = (text: string) => {
    if (!text) return [];

    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, index) => {
      // Handle Code Block
      if (part.startsWith('```')) {
        const lines = part.split('\n');
        const firstLine = lines[0].replace('```', '').trim();
        const language = firstLine || 'code';
        const code = lines.slice(1, -1).join('\n');

        return {
          type: 'code-block' as const,
          language,
          code,
          key: index,
        };
      }

      // Handle regular blocks (split by double newlines)
      const blocks = part.split(/\n\n+/g);
      return {
        type: 'text-blocks' as const,
        blocks: blocks.map((block) => {
          const lines = block.split('\n');
          const listItems: string[] = [];
          let isList = false;

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
              isList = true;
              listItems.push(trimmed.slice(2));
            } else if (trimmed.match(/^\d+\.\s/)) {
              isList = true;
              listItems.push(trimmed.replace(/^\d+\.\s/, ''));
            }
          }

          if (isList && listItems.length > 0) {
            return {
              type: 'list' as const,
              items: listItems,
            };
          }

          return {
            type: 'paragraph' as const,
            text: block,
          };
        }),
        key: index,
      };
    });
  };

  const renderTextWithInlineFormatting = (text: string) => {
    // Regex for inline code: `code`
    // Regex for bold: **text**
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    
    return parts.map((part, idx) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={idx} className="px-1.5 py-0.5 rounded bg-white/10 text-pink-400 font-mono text-xs border border-white/5">
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={idx} className="font-semibold text-white">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
  };

  const parsed = parseMarkdown(content);

  return (
    <div className="space-y-4 text-zinc-300 text-sm leading-relaxed select-text">
      {parsed.map((node) => {
        if (node.type === 'code-block') {
          return (
            <div key={node.key} className="relative rounded-xl overflow-hidden border border-white/10 bg-[#0c0c0e] my-3">
              <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/5 text-xs text-zinc-400 font-mono">
                <span>{node.language}</span>
                <button
                  onClick={() => handleCopy(node.code, node.key)}
                  className="flex items-center gap-1 hover:text-white transition-colors cursor-pointer"
                >
                  {copiedBlockIndex === node.key ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-4 overflow-x-auto text-xs text-zinc-200 font-mono leading-5">
                <code>{node.code}</code>
              </pre>
            </div>
          );
        }

        return (
          <div key={node.key} className="space-y-3">
            {node.blocks.map((block, bIdx) => {
              if (block.type === 'list') {
                return (
                  <ul key={bIdx} className="list-disc list-inside space-y-1.5 pl-2 text-zinc-300">
                    {block.items.map((item, itemIdx) => (
                      <li key={itemIdx} className="pl-1">
                        {renderTextWithInlineFormatting(item)}
                      </li>
                    ))}
                  </ul>
                );
              }

              // Simple Paragraph
              return (
                <p key={bIdx} className="whitespace-pre-line text-zinc-300">
                  {renderTextWithInlineFormatting(block.text)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
