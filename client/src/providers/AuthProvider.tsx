import React, { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const { checkAuth, isLoading, setUser } = useAuthStore();

  useEffect(() => {
    // Check authentication on initial load
    checkAuth();

    // Listen for unauthorized events from the Axios interceptor
    const handleUnauthorized = () => {
      setUser(null);
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);

    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, [checkAuth, setUser]);

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#09090b] relative overflow-hidden">
        {/* Ambient background glow effects */}
        <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-accent-violet/10 blur-[120px] pointer-events-none animate-sparkle"></div>
        <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 rounded-full bg-accent-blue/10 blur-[120px] pointer-events-none"></div>

        <div className="flex flex-col items-center gap-6 z-10">
          {/* Logo with pulsating brand glow */}
          <div className="relative">
            <div className="absolute -inset-1 rounded-full bg-gradient-to-r from-accent-violet via-accent-pink to-accent-blue opacity-75 blur-md animate-pulse"></div>
            <div className="relative w-16 h-16 rounded-full bg-[#131316] flex items-center justify-center border border-white/10">
              <svg 
                className="w-8 h-8 text-accent-violet animate-pulse" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor" 
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
          </div>

          <div className="text-center space-y-2">
            <h1 className="font-display text-2xl font-bold tracking-tight text-white bg-gradient-to-r from-white via-[#f4f4f5] to-zinc-400 bg-clip-text text-transparent">
              ContextChat
            </h1>
            <p className="text-zinc-500 text-sm font-medium tracking-wide">
              Securing connection...
            </p>
          </div>

          {/* Premium loading line indicator */}
          <div className="w-48 h-1 bg-zinc-800 rounded-full overflow-hidden relative">
            <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-accent-violet via-accent-pink to-accent-blue w-1/2 rounded-full animate-[loading_1.5s_infinite_ease-in-out]"></div>
          </div>
        </div>

        {/* Add temporary styling for the custom loading keyframe animation if needed */}
        <style>{`
          @keyframes loading {
            0% { left: -50%; }
            50% { left: 100%; }
            100% { left: 100%; }
          }
        `}</style>
      </div>
    );
  }

  return <>{children}</>;
};
