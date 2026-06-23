import { describe, expect, it } from 'vitest';
import { CampaignStatus, type Campaign } from '../types';
import { getCampaignPlannedSendTotal, getCampaignProgressMetrics, healCampaignCounters, healStuckCampaignStatus, isCampaignLikelyStartedOnServer, isCampaignQueueWorkComplete, isRunningStatusButWorkComplete } from './campaignMetrics';

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

  it('zera failedCount inflado com 1 contato aguardando resposta', () => {
    const c = baseCampaign({
      status: CampaignStatus.WAITING_REPLY,
      replyFlow: {
        enabled: true,
        steps: [{ body: 'Etapa 1' }, { body: 'Etapa 2' }]
      },
      successCount: 1,
      failedCount: 1,
      processedCount: 1,
      totalContacts: 1
    });
    expect(healCampaignCounters(c).failedCount).toBe(0);
  });

  it('limita contadores inflados enquanto aguarda resposta (retry duplicado no servidor)', () => {
    const c = baseCampaign({
      status: CampaignStatus.WAITING_REPLY,
      replyFlow: {
        enabled: true,
        steps: [{ body: 'Etapa 1' }, { body: 'Etapa 2' }]
      },
      successCount: 2,
      processedCount: 2,
      totalContacts: 1
    });
    const m = getCampaignProgressMetrics(c);
    expect(m.ok).toBe(1);
    expect(m.reported).toBe(1);
    expect(m.progressPct).toBe(100);
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

describe('healStuckCampaignStatus', () => {
  it('cura DRAFT→COMPLETED quando fila esgotada (sem reply flow)', () => {
    const c = baseCampaign({
      status: CampaignStatus.DRAFT,
      totalContacts: 1,
      processedCount: 1,
      successCount: 1
    });
    expect(healStuckCampaignStatus(c).status).toBe(CampaignStatus.COMPLETED);
    expect(isCampaignQueueWorkComplete(c)).toBe(true);
  });
});
