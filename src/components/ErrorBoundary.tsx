import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-base-900 px-4">
          <div className="max-w-md w-full text-center space-y-5">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-neon-red/10 border border-neon-red/30 flex items-center justify-center">
              <svg className="w-8 h-8 text-neon-red" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Something went wrong</h1>
              <p className="text-sm text-slate-400 mt-1.5">The application hit an unexpected error. Reloading usually fixes it.</p>
            </div>
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 text-left">
              <p className="text-[11px] text-neon-red font-mono break-words">{this.state.error?.message ?? 'Unknown error'}</p>
            </div>
            <button
              onClick={this.handleReload}
              className="px-5 py-2.5 rounded-xl bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/25 text-sm font-semibold transition-all"
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
