import React, { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

/**
 * Exibe erros de render em vez de deixar o body só com a cor de fundo (tela “preta”).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError || !this.state.error) {
      return this.props.children;
    }
    const { message, stack } = this.state.error;
    return (
      <div
        className="min-h-screen p-6 font-sans"
        style={{ background: '#0a0a0a', color: '#e5e5e5' }}
      >
        <h1 className="text-lg font-semibold text-white mb-2">Erro ao carregar a aplicação</h1>
        <p className="text-sm text-neutral-300 mb-4" style={{ maxWidth: 560 }}>
          {message}
        </p>
        {import.meta.env.DEV && stack ? (
          <pre className="text-xs overflow-auto p-3 rounded bg-black/40 text-neutral-400 max-h-64">{stack}</pre>
        ) : null}
        <button
          type="button"
          className="mt-6 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-500"
          onClick={() => window.location.reload()}
        >
          Recarregar página
        </button>
      </div>
    );
  }
}
