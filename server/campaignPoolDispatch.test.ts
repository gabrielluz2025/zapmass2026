import { describe, expect, it } from 'vitest';
import { pickInitialDispatchChannel, pickPoolChannelByStrategy } from './campaignPoolDispatch.js';

describe('pickInitialDispatchChannel / distribuição entre canais', () => {
  const chips = ['conn_a', 'conn_b', 'conn_c'];

  it('round-robin distribui em ordem', () => {
    const picks = [0, 1, 2, 3, 4, 5].map((i) =>
      pickInitialDispatchChannel({
        strategy: 'round_robin',
        connectionIds: chips,
        channelWeights: {},
        index: i,
      })
    );
    expect(picks).toEqual(['conn_a', 'conn_b', 'conn_c', 'conn_a', 'conn_b', 'conn_c']);
  });

  it('weighted respeita pesos (A=2, B=1 → 2A para cada B)', () => {
    const weights = { conn_a: 2, conn_b: 1, conn_c: 0 };
    const ids = ['conn_a', 'conn_b'];
    const picks = [0, 1, 2, 3, 4, 5].map((i) =>
      pickInitialDispatchChannel({
        strategy: 'weighted',
        connectionIds: ids,
        channelWeights: weights,
        index: i,
      })
    );
    // ciclo de soma 3: índices 0,1 → A; 2 → B
    expect(picks.filter((p) => p === 'conn_a').length).toBeGreaterThanOrEqual(4);
    expect(picks.filter((p) => p === 'conn_b').length).toBe(2);
  });

  it('priority sempre escolhe o primeiro saudável', () => {
    expect(
      pickPoolChannelByStrategy({
        strategy: 'priority',
        healthyIds: chips,
        channelWeights: {},
        index: 99,
      })
    ).toBe('conn_a');
  });
});
