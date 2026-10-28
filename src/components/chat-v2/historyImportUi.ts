/** Alinhado ao TTL inflight do servidor (`GO_INBOX_HISTORY_SYNC_INFLIGHT_TTL_MS`). */
export const HISTORY_IMPORT_UI_TTL_MS = 3 * 60 * 1000;

export type HistoryImportPayload = {
  importing?: boolean;
  connectionId?: string;
  reason?: string;
};

export type HistoryImportUiState = {
  active: boolean;
  stale: boolean;
  connectionId: string | null;
  startedAt: number | null;
};

export const initialHistoryImportUiState = (): HistoryImportUiState => ({
  active: false,
  stale: false,
  connectionId: null,
  startedAt: null,
});

export function applyHistoryImportEvent(
  prev: HistoryImportUiState,
  payload: HistoryImportPayload | null | undefined,
  now = Date.now()
): HistoryImportUiState {
  if (payload?.importing === true) {
    return {
      active: true,
      stale: false,
      connectionId: payload.connectionId ?? prev.connectionId,
      startedAt: prev.active && prev.startedAt != null ? prev.startedAt : now,
    };
  }
  if (payload?.importing === false) {
    return initialHistoryImportUiState();
  }
  return prev;
}

export function historyImportTtlElapsed(state: HistoryImportUiState, now = Date.now()): boolean {
  if (!state.active || state.startedAt == null) return false;
  return now - state.startedAt >= HISTORY_IMPORT_UI_TTL_MS;
}

export function markHistoryImportStale(state: HistoryImportUiState): HistoryImportUiState {
  if (!state.active) return state;
  return { ...state, active: false, stale: true };
}

/** Sidebar / thread: importação global ainda em andamento (não expirou). */
export function isPhoneHistoryImportActive(state: HistoryImportUiState): boolean {
  return state.active && !state.stale;
}
