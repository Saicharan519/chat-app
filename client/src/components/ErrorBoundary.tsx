import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in boundary:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#09090b] px-4 relative overflow-hidden">
          {/* Neon background blur */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-accent-pink/5 blur-[120px] pointer-events-none"></div>

          <div className="max-w-md w-full glass-panel rounded-2xl p-8 border border-white/5 shadow-2xl relative z-10 text-center space-y-6">
            {/* Error Icon */}
            <div className="mx-auto w-16 h-16 rounded-2xl bg-accent-pink/15 flex items-center justify-center border border-accent-pink/30">
              <svg 
                className="w-8 h-8 text-accent-pink" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor" 
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>

            <div className="space-y-2">
              <h2 className="font-display text-2xl font-bold tracking-tight text-white">
                Something went wrong
              </h2>
              <p className="text-zinc-400 text-sm">
                An unexpected error occurred in the interface. Don't worry, we logged the details.
              </p>
            </div>

            {this.state.error && (
              <div className="bg-black/40 rounded-lg p-4 border border-white/5 text-left overflow-x-auto max-h-32 text-xs font-mono text-zinc-500">
                {this.state.error.toString()}
              </div>
            )}

            <button
              onClick={this.handleReload}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-accent-violet to-accent-pink hover:from-accent-violet/90 hover:to-accent-pink/90 text-white font-medium text-sm transition-all duration-200 shadow-lg shadow-accent-violet/20 hover:shadow-accent-violet/30 active:scale-[0.98]"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
