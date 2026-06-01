import React from 'react';

interface TypingIndicatorProps {
  names: string[];
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ names }) => {
  if (names.length === 0) return null;

  let text = '';
  if (names.length === 1) {
    text = `${names[0]} is typing...`;
  } else if (names.length === 2) {
    text = `${names[0]} and ${names[1]} are typing...`;
  } else {
    text = 'Several people are typing...';
  }

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 text-zinc-400 text-xs select-none">
      <div className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 typing-dot" />
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 typing-dot" />
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 typing-dot" />
      </div>
      <span>{text}</span>
    </div>
  );
};
