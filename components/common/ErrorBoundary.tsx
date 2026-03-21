/**
 * BorderPay Africa - Premium Error Boundary
 * Catches React render errors with professional recovery UI
 * Banking-grade: logs errors, shows branded fallback, offers recovery
 */

import React, { Component, ReactNode } from 'react';
import { ShieldAlert, RefreshCw, Home, ChevronDown, Copy, CheckCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  showDetails: boolean;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[BorderPay ErrorBoundary] Caught error:', error);
    console.error('[BorderPay ErrorBoundary] Component stack:', errorInfo.componentStack);
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.hash = '';
    window.location.pathname = '/';
    window.location.reload();
  };

  handleCopyError = () => {
    const { error, errorInfo } = this.state;
    const report = [
      `BorderPay Error Report`,
      `Date: ${new Date().toISOString()}`,
      `Error: ${error?.message}`,
      `Stack: ${error?.stack || 'N/A'}`,
      `Component: ${errorInfo?.componentStack || 'N/A'}`,
    ].join('\n');
    navigator.clipboard.writeText(report).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { error, showDetails, copied } = this.state;

      return (
        <div className="fixed inset-0 bg-[#0B0E11] flex items-center justify-center p-5 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          <div className="w-full max-w-[380px]">
            {/* Main card */}
            <div
              className="rounded-3xl p-6 text-center relative overflow-hidden"
              style={{
                background: 'rgba(255,77,106,0.04)',
                border: '1px solid rgba(255,77,106,0.12)',
                boxShadow: '0 8px 40px -8px rgba(255,77,106,0.15)',
              }}
            >
              {/* Ambient glow */}
              <div
                className="absolute -top-16 left-1/2 -translate-x-1/2 w-40 h-40 rounded-full pointer-events-none"
                style={{
                  background: 'radial-gradient(circle, rgba(255,77,106,0.08) 0%, transparent 70%)',
                }}
              />

              {/* Icon */}
              <div className="relative z-10">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
                  style={{ background: 'rgba(255,77,106,0.10)' }}
                >
                  <ShieldAlert size={28} className="text-[#FF4D6A]" />
                </div>

                {/* Title */}
                <h1 className="text-lg font-bold text-white mb-2">
                  Something Went Wrong
                </h1>
                <p className="text-sm text-white/50 leading-relaxed mb-6 max-w-[280px] mx-auto">
                  {error?.message?.includes('chunk')
                    ? 'A loading error occurred. This usually fixes itself with a refresh.'
                    : 'An unexpected error occurred in the application. Your data is safe — no funds or personal information have been affected.'
                  }
                </p>

                {/* Primary action */}
                <button
                  onClick={this.handleReload}
                  className="w-full bg-[#C7FF00] text-black py-3.5 rounded-2xl font-bold text-sm hover:bg-[#B8F000] transition-all active:scale-[0.97] flex items-center justify-center gap-2 mb-3"
                >
                  <RefreshCw size={16} />
                  Reload App
                </button>

                {/* Secondary action */}
                <button
                  onClick={this.handleGoHome}
                  className="w-full bg-white/5 border border-white/10 text-white py-3.5 rounded-2xl font-semibold text-sm hover:bg-white/8 transition-all active:scale-[0.97] flex items-center justify-center gap-2 mb-4"
                >
                  <Home size={16} />
                  Go to Home
                </button>

                {/* Error details toggle */}
                <button
                  onClick={() => this.setState({ showDetails: !showDetails })}
                  className="flex items-center gap-1.5 mx-auto text-[11px] text-white/30 hover:text-white/50 transition-colors"
                >
                  <ChevronDown
                    size={12}
                    className={`transition-transform ${showDetails ? 'rotate-180' : ''}`}
                  />
                  {showDetails ? 'Hide' : 'Show'} Error Details
                </button>

                {/* Collapsible details */}
                {showDetails && (
                  <div className="mt-4 text-left">
                    <div
                      className="rounded-xl p-3 relative"
                      style={{
                        background: 'rgba(0,0,0,0.4)',
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}
                    >
                      {/* Copy button */}
                      <button
                        onClick={this.handleCopyError}
                        className="absolute top-2.5 right-2.5 w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                      >
                        {copied ? (
                          <CheckCircle size={12} className="text-[#C7FF00]" />
                        ) : (
                          <Copy size={12} className="text-white/40" />
                        )}
                      </button>

                      <p className="text-[10px] text-white/25 uppercase tracking-wider font-semibold mb-1.5">
                        Error
                      </p>
                      <p className="text-xs text-[#FF4D6A] font-mono break-all leading-relaxed pr-8">
                        {error?.message || 'Unknown error'}
                      </p>

                      {error?.stack && (
                        <>
                          <p className="text-[10px] text-white/25 uppercase tracking-wider font-semibold mt-3 mb-1.5">
                            Stack Trace
                          </p>
                          <pre className="text-[10px] text-white/20 font-mono overflow-x-auto max-h-32 overflow-y-auto leading-relaxed whitespace-pre-wrap break-all">
                            {error.stack.split('\n').slice(1, 6).join('\n')}
                          </pre>
                        </>
                      )}
                    </div>

                    <p className="text-[10px] text-white/20 text-center mt-3">
                      If this keeps happening, please contact support with the error details above.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* App branding */}
            <div className="flex items-center justify-center gap-2 mt-6 opacity-30">
              <div className="w-5 h-5 rounded-md bg-[#C7FF00] flex items-center justify-center">
                <span className="text-[8px] font-black text-black">BP</span>
              </div>
              <span className="text-[11px] font-semibold text-white/40 tracking-wide">
                BorderPay Africa
              </span>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}