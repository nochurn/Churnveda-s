import React from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import type { FirestoreErrorInfo } from '../lib/firebaseClient';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  firestoreError: FirestoreErrorInfo | null;
}

function parseFirestoreError(error: Error | null): FirestoreErrorInfo | null {
  if (!error?.message) return null;
  try {
    const parsed = JSON.parse(error.message);
    if (parsed && typeof parsed === 'object' && 'operationType' in parsed && 'error' in parsed) {
      return parsed as FirestoreErrorInfo;
    }
  } catch {
    // Not a serialized FirestoreErrorInfo
  }
  return null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  declare state: ErrorBoundaryState;
  declare props: Readonly<ErrorBoundaryProps>;
  declare setState: (state: Partial<ErrorBoundaryState>) => void;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      firestoreError: null
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
      firestoreError: parseFirestoreError(error)
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught application error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      firestoreError: null
    });
  };

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, firestoreError } = this.state;
    const isPermissionError =
      firestoreError?.error?.toLowerCase().includes('permission') ||
      error?.message?.toLowerCase().includes('missing or insufficient permissions');

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-red-50 text-red-700 border border-red-200 shrink-0">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold text-slate-900">
                {firestoreError ? 'Database Synchronization Error' : 'Something went wrong'}
              </h1>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                {isPermissionError
                  ? 'Your account does not have permission to complete this database operation. Verify that you are signed in with a verified email and belong to this workspace.'
                  : 'An unexpected error interrupted this view. You can retry the view or reload the workspace.'}
              </p>

              {firestoreError ? (
                <div className="mt-4 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 space-y-1">
                  <div>
                    <span className="font-semibold text-slate-900">Operation:</span>{' '}
                    <span className="font-mono">{firestoreError.operationType}</span>
                  </div>
                  {firestoreError.path && (
                    <div className="truncate">
                      <span className="font-semibold text-slate-900">Path:</span>{' '}
                      <span className="font-mono">{firestoreError.path}</span>
                    </div>
                  )}
                  <div className="break-words">
                    <span className="font-semibold text-slate-900">Details:</span>{' '}
                    <span>{firestoreError.error}</span>
                  </div>
                </div>
              ) : (
                error?.message && (
                  <div className="mt-4 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 font-mono break-words">
                    {error.message}
                  </div>
                )
              )}

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={this.handleReset}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Try Again</span>
                </button>
                <button
                  type="button"
                  onClick={this.handleReload}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-sm font-semibold transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Reload Workspace</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
