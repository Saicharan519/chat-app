import React from 'react';

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  online?: boolean;
}

export const Avatar: React.FC<AvatarProps> = ({ name, size = 'md', online = false }) => {
  const initial = name ? name.trim().charAt(0).toUpperCase() : '?';

  const sizeClasses = {
    sm: 'w-7 h-7 text-xs',
    md: 'w-9 h-9 text-sm',
    lg: 'w-11 h-11 text-base',
  };

  return (
    <div className="relative inline-flex shrink-0 select-none">
      <div
        className={`flex items-center justify-center rounded-full bg-gradient-to-tr from-accent-violet to-accent-pink font-semibold text-white ${sizeClasses[size]}`}
      >
        {initial}
      </div>
      {online && (
        <span
          className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#09090b]"
          aria-label="Online"
        />
      )}
    </div>
  );
};
