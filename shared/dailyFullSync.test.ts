import { describe, expect, it } from 'vitest';
import { isFullSyncDue, isFullSyncDueAfterRestart } from './dailyFullSync.js';

describe('isFullSyncDueAfterRestart', () => {
  it('força sync se o último findChats foi antes do processo atual', () => {
    const processStartedAt = 1_000_000;
    const lastAtMs = processStartedAt - 60_000;
    expect(isFullSyncDueAfterRestart(lastAtMs, processStartedAt, processStartedAt + 5_000)).toBe(true);
  });

  it('respeita cooldown se o sync já rodou neste processo', () => {
    const processStartedAt = 1_000_000;
    const lastAtMs = processStartedAt + 1_000;
    expect(isFullSyncDueAfterRestart(lastAtMs, processStartedAt, lastAtMs + 60_000)).toBe(false);
  });

  it('trata last=0 como due', () => {
    expect(isFullSyncDue(0)).toBe(true);
    expect(isFullSyncDueAfterRestart(0, 1_000_000)).toBe(true);
  });
});
