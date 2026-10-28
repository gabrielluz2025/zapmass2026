import { describe, expect, it } from 'vitest';
import {
  HISTORY_IMPORT_UI_TTL_MS,
  applyHistoryImportEvent,
  historyImportTtlElapsed,
  initialHistoryImportUiState,
  isPhoneHistoryImportActive,
  markHistoryImportStale,
} from './historyImportUi';

describe('historyImportUi', () => {
  it('liga importação e preserva startedAt durante rajadas', () => {
    const t0 = 1_000_000;
    let s = applyHistoryImportEvent(initialHistoryImportUiState(), { importing: true }, t0);
    expect(isPhoneHistoryImportActive(s)).toBe(true);
    s = applyHistoryImportEvent(s, { importing: true, connectionId: 'chip-a' }, t0 + 5000);
    expect(s.startedAt).toBe(t0);
    expect(s.connectionId).toBe('chip-a');
  });

  it('desliga importação ao receber importing false', () => {
    const s = applyHistoryImportEvent(
      applyHistoryImportEvent(initialHistoryImportUiState(), { importing: true }, 0),
      { importing: false, reason: 'offline_sync_completed' },
      100
    );
    expect(isPhoneHistoryImportActive(s)).toBe(false);
    expect(s.stale).toBe(false);
  });

  it('TTL marca stale após 3 minutos', () => {
    const started = 0;
    const s = applyHistoryImportEvent(initialHistoryImportUiState(), { importing: true }, started);
    expect(historyImportTtlElapsed(s, started + HISTORY_IMPORT_UI_TTL_MS - 1)).toBe(false);
    expect(historyImportTtlElapsed(s, started + HISTORY_IMPORT_UI_TTL_MS)).toBe(true);
    const stale = markHistoryImportStale(s);
    expect(isPhoneHistoryImportActive(stale)).toBe(false);
    expect(stale.stale).toBe(true);
  });
});
