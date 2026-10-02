import { describe, expect, it } from 'vitest';
import {
  clearHumanManualDispatchPaused,
  isHumanManualDispatchPaused,
  markHumanManualDispatchPausedForCampaigns
} from './humanManualDispatchPause.js';

describe('humanManualDispatchPause', () => {
  const tenant = 'tenant-test-human-pause';
  const phone = '5547999887766';
  const campaignA = 'camp-a';
  const campaignB = 'camp-b';

  it('pausa só a campanha indicada', async () => {
    expect(await isHumanManualDispatchPaused(tenant, phone, campaignA)).toBe(false);
    await markHumanManualDispatchPausedForCampaigns(tenant, phone, [campaignA]);
    expect(await isHumanManualDispatchPaused(tenant, phone, campaignA)).toBe(true);
    expect(await isHumanManualDispatchPaused(tenant, phone, campaignB)).toBe(false);
    expect(await isHumanManualDispatchPaused('other-tenant', phone, campaignA)).toBe(false);
  });

  it('libera disparo após clear (ex.: finalizar atendimento)', async () => {
    await markHumanManualDispatchPausedForCampaigns(tenant, phone, [campaignA, campaignB]);
    expect(await isHumanManualDispatchPaused(tenant, phone, campaignA)).toBe(true);
    await clearHumanManualDispatchPaused(tenant, phone);
    expect(await isHumanManualDispatchPaused(tenant, phone, campaignA)).toBe(false);
    expect(await isHumanManualDispatchPaused(tenant, phone, campaignB)).toBe(false);
  });

  it('sem campaignId não bloqueia (sem pausa global)', async () => {
    await markHumanManualDispatchPausedForCampaigns(tenant, phone, [campaignA]);
    expect(await isHumanManualDispatchPaused(tenant, phone)).toBe(false);
  });
});
