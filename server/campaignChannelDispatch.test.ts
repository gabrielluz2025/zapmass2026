import { describe, expect, it } from 'vitest';
import {
  getChannelActiveSendLimit,
  getChannelHotSlotLimit,
  pickFairHeldCampaignRoundRobin,
  releaseChannelHotSlot,
  releaseChannelSendSlot,
  tryAcquireChannelSendSlot,
  tryReserveChannelHotSlot,
} from './campaignChannelDispatch.js';

describe('campaignChannelDispatch', () => {
  it('limita envio ativo por chip (memória)', async () => {
    const conn = 'chip-a';
    expect(await tryAcquireChannelSendSlot(null, conn, 'job-1')).toBe(true);
    expect(await tryAcquireChannelSendSlot(null, conn, 'job-2')).toBe(false);
    expect(await tryAcquireChannelSendSlot(null, conn, 'job-1')).toBe(true);
    await releaseChannelSendSlot(null, conn, 'job-1');
    expect(await tryAcquireChannelSendSlot(null, conn, 'job-2')).toBe(true);
  });

  it('limita vagas quentes globais por chip', async () => {
    const conn = 'chip-b';
    const limit = getChannelHotSlotLimit();
    for (let i = 0; i < limit; i++) {
      expect(await tryReserveChannelHotSlot(null, conn)).toBe(true);
    }
    expect(await tryReserveChannelHotSlot(null, conn)).toBe(false);
    await releaseChannelHotSlot(null, conn);
    expect(await tryReserveChannelHotSlot(null, conn)).toBe(true);
  });

  it('round-robin entre campanhas no mesmo chip', () => {
    const ids = ['camp-z', 'camp-a', 'camp-m'];
    const r1 = pickFairHeldCampaignRoundRobin(ids, 0);
    expect(r1.order).toEqual(['camp-a', 'camp-m', 'camp-z']);
    expect(r1.nextIndex).toBe(1);
    const r2 = pickFairHeldCampaignRoundRobin(ids, r1.nextIndex);
    expect(r2.order[0]).toBe('camp-m');
  });

  it('defaults de limite', () => {
    expect(getChannelActiveSendLimit()).toBeGreaterThanOrEqual(1);
    expect(getChannelHotSlotLimit()).toBeGreaterThanOrEqual(1);
  });
});
