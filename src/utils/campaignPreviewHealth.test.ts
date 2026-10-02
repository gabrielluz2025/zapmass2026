import { describe, expect, it } from 'vitest';
import {
  chipResultsFromLocalConnections,
  chipStatusFromResults,
  motorStatusFromDispatchHealth,
  freqCapStatusAfterCheck,
} from './campaignPreviewHealth';
import { ConnectionStatus } from '../types';

describe('motorStatusFromDispatchHealth', () => {
  it('ok quando fila responde', () => {
    expect(
      motorStatusFromDispatchHealth({
        ok: true,
        ready: true,
        kind: 'ok',
        reachable: true,
        redis: { ok: true },
      })
    ).toBe('ok');
  });

  it('warn em falha de rede no browser', () => {
    expect(
      motorStatusFromDispatchHealth({
        ok: false,
        ready: false,
        kind: 'network',
        reachable: false,
        redis: { ok: false },
      })
    ).toBe('warn');
  });

  it('error quando Redis está fora no servidor', () => {
    expect(
      motorStatusFromDispatchHealth({
        ok: false,
        ready: false,
        kind: 'redis_down',
        reachable: true,
        redis: { ok: false, error: 'down' },
      })
    ).toBe('error');
  });
});

describe('chip fallback local', () => {
  it('marca CONNECTED como pronto', () => {
    const results = chipResultsFromLocalConnections(['c1'], [
      {
        id: 'c1',
        name: 'Chip',
        phoneNumber: '5511',
        status: ConnectionStatus.CONNECTED,
        lastActivity: '',
      },
    ]);
    expect(results[0]?.isReady).toBe(true);
    expect(chipStatusFromResults(results, { usedLocalFallback: true })).toBe('warn');
  });
});

describe('freqCapStatusAfterCheck', () => {
  it('degrada erro de API para warn', () => {
    expect(freqCapStatusAfterCheck(false, true)).toBe('warn');
  });
});
