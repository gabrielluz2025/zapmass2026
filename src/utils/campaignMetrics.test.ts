import { describe, expect, it } from 'vitest';
import { CampaignStatus, type Campaign } from '../types';
import { getCampaignPlannedSendTotal, getCampaignProgressMetrics, isCampaignLikelyStartedOnServer, isRunningStatusButWorkComplete } from './campaignMetrics';

const baseCampaign = (patch: Partial<Campaign> = {}): Campaign => ({
  id: 'c1',
  name: 'Test',
  message: 'Olá',
  totalContacts: 1,
  processedCount: 0,
  successCount: 0,
  failedCount: 0,
  status: CampaignStatus.RUNNING,
  selectedConnectionIds: ['chip1'],
  createdAt: new Date().toISOString(),
  ...patch
});

describe('campaignMetrics — fluxo conversacional', () => {
  it('planeja 1 envio por contato quando reply flow tem 2+ etapas', () => {
    const c = baseCampaign({
      replyFlow: {
        enabled: true,
        steps: [{ body: 'Etapa 1' }, { body: 'Etapa 2' }]
      },
      successCount: 1,
      processedCount: 1
    });
    expect(getCampaignPlannedSendTotal(c)).toBe(1);
    const m = getCampaignProgressMetrics(c);
    expect(m.pending).toBe(0);
    expect(m.progressPct).toBe(100);
  });

  it('não auto-cura RUNNING→COMPLETED enquanto aguarda respostas (reply flow)', () => {
    const c = baseCampaign({
      replyFlow: {
        enabled: true,
        steps: [{ body: 'Etapa 1' }, { body: 'Etapa 2' }]
      },
      successCount: 1,
      processedCount: 1
    });
    expect(isRunningStatusButWorkComplete(c)).toBe(false);
  });

  it('campanha sequencial multi-etapa mantém contacts × stages', () => {
    const c = baseCampaign({
      messageStages: ['Msg 1', 'Msg 2'],
      successCount: 1,
      processedCount: 1
    });
    expect(getCampaignPlannedSendTotal(c)).toBe(2);
    const m = getCampaignProgressMetrics(c);
    expect(m.pending).toBe(1);
    expect(m.progressPct).toBe(50);
  });
});

describe('isCampaignLikelyStartedOnServer', () => {
  it('detecta campanha ativa ou com envios', () => {
    expect(isCampaignLikelyStartedOnServer(undefined)).toBe(false);
    expect(isCampaignLikelyStartedOnServer(baseCampaign({ status: CampaignStatus.DRAFT }))).toBe(false);
    expect(isCampaignLikelyStartedOnServer(baseCampaign({ status: CampaignStatus.RUNNING }))).toBe(true);
    expect(isCampaignLikelyStartedOnServer(baseCampaign({ status: CampaignStatus.WAITING_REPLY }))).toBe(true);
    expect(
      isCampaignLikelyStartedOnServer(
        baseCampaign({ status: CampaignStatus.DRAFT, successCount: 1, processedCount: 1 })
      )
    ).toBe(true);
  });
});
