import { describe, expect, it } from 'vitest';
import { splitCampaignDispatchWindow } from './campaignDispatchWindow.js';

describe('splitCampaignDispatchWindow', () => {
  it('deixa dois por canal na fila e guarda o resto', () => {
    const entries = ['a', 'b', 'a', 'b', 'a', 'b'].map((connectionId, i) => ({
      item: { connectionId, to: String(i) },
      delayMs: i * 30_000,
    }));
    const { hot, held } = splitCampaignDispatchWindow(entries, 2, 20_000);
    expect(hot.map((e) => e.item.to)).toEqual(['0', '1', '2', '3']);
    expect(hot.map((e) => e.delayMs)).toEqual([0, 0, 20_000, 20_000]);
    expect(held.map((e) => e.item.to)).toEqual(['4', '5']);
  });

  it('resposta de gatilho não entra na espera', () => {
    const { hot, held } = splitCampaignDispatchWindow(
      [
        { item: { connectionId: 'a', replyFlowResponse: true }, delayMs: 0 },
        { item: { connectionId: 'a' }, delayMs: 10 },
        { item: { connectionId: 'a' }, delayMs: 20 },
        { item: { connectionId: 'a' }, delayMs: 30 },
      ],
      1,
      5_000
    );
    expect(hot).toHaveLength(2);
    expect(hot[0].item.replyFlowResponse).toBe(true);
    expect(held).toHaveLength(2);
  });
});
