import type { DispatchHealth } from '../services/campaignsApi';
import type { ConnectionStatus, WhatsAppConnection } from '../types';

export type PreviewHealthStatus = 'idle' | 'checking' | 'ok' | 'warn' | 'error' | 'reconnecting';

export type PreviewChipResult = {
  connectionId: string;
  status: string;
  isReady: boolean;
  error: string | null;
};

/** Mapeia saúde Redis/fila para o cartão «Motor de envio» do preview. */
export function motorStatusFromDispatchHealth(health: DispatchHealth): PreviewHealthStatus {
  if (health.ok) return 'ok';
  if (health.reachable === false || health.kind === 'network') return 'warn';
  if (health.kind === 'misconfig' || health.kind === 'redis_down') return 'error';
  return 'warn';
}

export function isConnectionOnlineForPreview(status: ConnectionStatus): boolean {
  return status === 'CONNECTED' || status === 'BUSY';
}

/** Fallback local quando POST /preflight falha (rede, 401, timeout). */
export function chipResultsFromLocalConnections(
  connectionIds: string[],
  connections: WhatsAppConnection[]
): PreviewChipResult[] {
  const byId = new Map(connections.map((c) => [c.id, c]));
  return connectionIds.map((connectionId) => {
    const conn = byId.get(connectionId);
    if (!conn) {
      return {
        connectionId,
        status: 'unknown',
        isReady: false,
        error: 'Chip não encontrado na sessão — clique em Reverificar',
      };
    }
    const online = isConnectionOnlineForPreview(conn.status);
    return {
      connectionId,
      status: online ? 'open' : String(conn.status).toLowerCase(),
      isReady: online,
      error: online ? null : `Status local: ${conn.status}`,
    };
  });
}

export function chipStatusFromResults(
  results: PreviewChipResult[],
  opts: { usedLocalFallback: boolean }
): PreviewHealthStatus {
  if (results.length === 0) return 'warn';
  if (results.every((r) => r.isReady)) return opts.usedLocalFallback ? 'warn' : 'ok';
  if (results.some((r) => r.isReady)) return 'warn';
  return 'error';
}

export function chipStatusHint(
  chipStatus: PreviewHealthStatus,
  opts: {
    selectedCount: number;
    usedLocalFallback: boolean;
    preflightError?: string | null;
  }
): string {
  if (chipStatus === 'ok') {
    return 'online';
  }
  if (chipStatus === 'error') {
    return 'offline';
  }
  if (chipStatus === 'checking') {
    return 'checking';
  }
  if (opts.selectedCount === 0) {
    return 'none_selected';
  }
  if (opts.preflightError?.trim()) {
    return 'api_failed';
  }
  if (opts.usedLocalFallback) {
    return 'local_fallback';
  }
  return 'unknown';
}

export const CHIP_STATUS_LABELS: Record<string, string> = {
  online: 'online',
  offline: 'offline',
  checking: 'checking',
  none_selected: 'none_selected',
  api_failed: 'api_failed',
  local_fallback: 'local_fallback',
  unknown: 'unknown',
};

export function formatChipStatusLine(
  chipStatus: PreviewHealthStatus,
  results: PreviewChipResult[],
  hintKey: string
): string {
  if (chipStatus === 'ok') {
    const ready = results.filter((r) => r.isReady).length;
    return `${ready}/${results.length} online`;
  }
  if (chipStatus === 'error') {
    const off = results.filter((r) => !r.isReady).length;
    return `${off} chip(s) offline`;
  }
  if (chipStatus === 'checking') {
    return 'Verificando…';
  }
  if (hintKey === 'none_selected') {
    return 'Nenhum chip selecionado';
  }
  if (hintKey === 'api_failed') {
    return 'API indisponível — status local abaixo';
  }
  if (hintKey === 'local_fallback') {
    const ready = results.filter((r) => r.isReady).length;
    return `${ready}/${results.length} online (sessão local)`;
  }
  return 'Não verificado';
}

export type FreqCapPreviewStatus = 'idle' | 'checking' | 'ok' | 'warn' | 'error';

/** Erro de API no cap 24h degrada para warn — o servidor aplica no envio. */
export function freqCapStatusAfterCheck(ok: boolean, degraded: boolean): FreqCapPreviewStatus {
  if (ok) return 'ok';
  if (degraded) return 'warn';
  return 'error';
}
