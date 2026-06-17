import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { forceAppHardReload, isChunkLoadError } from '../utils/chunkLoadRecovery';

type Props = { children: ReactNode; label?: string };
type State = { hasError: boolean; error: Error | null };

/** Erro ao carregar aba lazy (chunk 404 pós-deploy) — não derruba o app inteiro. */
export class TabLoadErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[TabLoadErrorBoundary]', error, info.componentStack);
    if (isChunkLoadError(error)) {
      forceAppHardReload(this.props.label || 'tab');
    }
  }

  render() {
    if (!this.state.hasError || !this.state.error) {
      return this.props.children;
    }

    const chunkStale = isChunkLoadError(this.state.error);

    return (
      <div
        className="flex flex-1 min-h-[36vh] w-full flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ color: 'var(--text-2)' }}
      >
        <Loader2 className="w-8 h-8 text-amber-500" />
        <div className="max-w-md space-y-2">
          <p className="text-[15px] font-semibold" style={{ color: 'var(--text-1)' }}>
            {chunkStale ? 'Atualizando painel…' : 'Não foi possível abrir este painel'}
          </p>
          <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
            {chunkStale
              ? 'Detectamos arquivos antigos após o deploy. A página vai recarregar automaticamente.'
              : this.state.error.message}
          </p>
        </div>
        {!chunkStale && (
          <button
            type="button"
            onClick={() => forceAppHardReload(this.props.label || 'tab-manual')}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold text-white bg-emerald-600 hover:bg-emerald-500"
          >
            <RefreshCw className="w-4 h-4" />
            Recarregar
          </button>
        )}
      </div>
    );
  }
}
