import { describe, expect, it } from 'vitest';
import { evaluateCampaignDispatchGuard } from '../server/campaignChipGuard.js';

describe('evaluateCampaignDispatchGuard', () => {
  const usable = (id: string) => id === 'chip-a';

  it('pausa em ban cooldown mesmo com chip ok', async () => {
    const r = await evaluateCampaignDispatchGuard({
      ownerUid: 't1',
      channelIds: ['chip-a', 'chip-b'],
      chipProtectionLockUntil: new Date(Date.now() + 3600_000).toISOString(),
      chipProtectionLockReason: 'ban_cooldown',
      isChannelUsable: usable,
    });
    expect(r.action).toBe('pause');
    if (r.action === 'pause') expect(r.reason).toBe('ban_cooldown');
  });

  it('desacelera em reconnect storm com chip ok', async () => {
    const r = await evaluateCampaignDispatchGuard({
      ownerUid: 't1',
      channelIds: ['chip-a'],
      chipProtectionLockUntil: new Date(Date.now() + 3600_000).toISOString(),
      chipProtectionLockReason: 'reconnect_storm',
      isChannelUsable: usable,
    });
    expect(r.action).toBe('slow');
  });

  it('pausa quando todos chips indisponíveis', async () => {
    const r = await evaluateCampaignDispatchGuard({
      ownerUid: 't1',
      channelIds: ['chip-x'],
      isChannelUsable: () => false,
    });
    expect(r.action).toBe('pause');
    if (r.action === 'pause') expect(r.reason).toBe('all_channels_down');
  });

  it('prossegue com chip disponível', async () => {
    const r = await evaluateCampaignDispatchGuard({
      ownerUid: 't1',
      channelIds: ['chip-a'],
      isChannelUsable: usable,
    });
    expect(r.action).toBe('proceed');
  });
});
