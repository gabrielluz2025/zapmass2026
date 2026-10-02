import { describe, expect, it } from 'vitest';
import { CampaignStatus, type Campaign } from '../types';
import {
  getCampaignPlannedSendTotal,
  getCampaignProgressMetrics,
  healCampaignCounters,
  campaignStatusAfterProgress,
  healStuckCampaignStatus,
  healCampaignDocument,
  resolveCampaignTerminalStatus,
  isPhantomZeroOutcomeCampaign,
  isCampaignLikelyStartedOnServer,
  isCampaignQueueWorkComplete,
  isRunningStatusButWorkComplete,
  mergeCampaignMetricsWithReport,
  isCampaignPlayButtonVisible
} from './campaignMetrics';

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

import {
  CAMPAIGN_REMAINING_CONTACTS_LABEL,
  CAMPAIGN_REMAINING_CONTACTS_TITLE,
} from './campaignQueueMetricCopy';

describe('rótulos de métricas de campanha', () => {
  it('usa Restantes com tooltip que distingue contadores de fila Bull', () => {
    expect(CAMPAIGN_REMAINING_CONTACTS_LABEL).toBe('Restantes');
    expect(CAMPAIGN_REMAINING_CONTACTS_TITLE).toMatch(/Bull/i);
  });
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

  it('cura DRAFT preso com 1ª etapa enviada → WAITING_REPLY', () => {
    const c = baseCampaign({
      status: CampaignStatus.DRAFT,
      replyFlow: {
        enabled: true,
        steps: [{ body: 'Etapa 1' }, { body: 'Etapa 2' }]
      },
      successCount: 1,
      processedCount: 1,
      totalContacts: 1
    });
    expect(healStuckCampaignStatus(c).status).toBe(CampaignStatus.WAITING_REPLY);
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

describe('isCampaignPlayButtonVisible', () => {
  it('esconde Play quando a fila inicial já terminou (DRAFT curado para Concluída)', () => {
    const c = baseCampaign({
      status: CampaignStatus.DRAFT,
      totalContacts: 1,
      processedCount: 1,
      successCount: 1
    });
    expect(isCampaignPlayButtonVisible(c)).toBe(false);
  });

  it('mostra Play em DRAFT sem envios (iniciar depois)', () => {
    const c = baseCampaign({ status: CampaignStatus.DRAFT, totalContacts: 1 });
    expect(isCampaignPlayButtonVisible(c)).toBe(true);
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
  it('cura DRAFT→RUNNING quando já há envios gravados', () => {
    const c = baseCampaign({
      status: CampaignStatus.DRAFT,
      totalContacts: 100,
      processedCount: 10,
      successCount: 8,
      failedCount: 2
    });
    expect(healStuckCampaignStatus(c).status).toBe(CampaignStatus.RUNNING);
  });

  it('cura DRAFT→FAILED quando só houve falhas', () => {
    const c = baseCampaign({
      status: CampaignStatus.DRAFT,
      totalContacts: 1,
      processedCount: 1,
      successCount: 0,
      failedCount: 1
    });
    expect(healStuckCampaignStatus(c).status).toBe(CampaignStatus.FAILED);
  });

  it('marca Falhou quando processed não tem skip explícito (fantasma)', () => {
    const c = baseCampaign({
      status: CampaignStatus.RUNNING,
      totalContacts: 1,
      processedCount: 1,
      successCount: 0,
      failedCount: 0
    });
    expect(healStuckCampaignStatus(c).status).toBe(CampaignStatus.FAILED);
  });

  it('cura RUNNING→COMPLETED quando skip explícito (ex.: limite 24 h)', () => {
    const c = baseCampaign({
      status: CampaignStatus.RUNNING,
      totalContacts: 1,
      processedCount: 1,
      successCount: 0,
      failedCount: 0,
      skippedCount: 1
    });
    expect(healStuckCampaignStatus(c).status).toBe(CampaignStatus.COMPLETED);
  });

  it('reclassifica COMPLETED falso (0 entregues, só falhas) para FAILED', () => {
    const c = baseCampaign({
      status: CampaignStatus.COMPLETED,
      totalContacts: 1,
      processedCount: 1,
      successCount: 0,
      failedCount: 1
    });
    expect(healCampaignDocument(c).status).toBe(CampaignStatus.FAILED);
  });

  it('cura DRAFT→COMPLETED quando fila esgotada com sucesso', () => {
    const c = baseCampaign({
      status: CampaignStatus.DRAFT,
      totalContacts: 1,
      processedCount: 1,
      successCount: 1
    });
    expect(healStuckCampaignStatus(c).status).toBe(CampaignStatus.COMPLETED);
  });

  it('detecta Concluída fantasma (100% sem entrega/falha/skip)', () => {
    const c = baseCampaign({
      status: CampaignStatus.COMPLETED,
      totalContacts: 1,
      processedCount: 1,
      successCount: 0,
      failedCount: 0
    });
    expect(isPhantomZeroOutcomeCampaign(c)).toBe(true);
    expect(healCampaignDocument(c).status).toBe(CampaignStatus.FAILED);
    const runningPhantom = baseCampaign({
      status: CampaignStatus.RUNNING,
      totalContacts: 1,
      processedCount: 1,
      successCount: 0,
      failedCount: 0
    });
    expect(isCampaignQueueWorkComplete(runningPhantom)).toBe(false);
  });

  it('não marca fantasma quando há skip explícito', () => {
    const c = baseCampaign({
      status: CampaignStatus.COMPLETED,
      totalContacts: 1,
      processedCount: 1,
      successCount: 0,
      failedCount: 0,
      skippedCount: 1
    });
    expect(isPhantomZeroOutcomeCampaign(c)).toBe(false);
    expect(
      resolveCampaignTerminalStatus({ successCount: 0, failCount: 0, skipCount: 1 })
    ).toBe(CampaignStatus.COMPLETED);
  });

  it('resolveCampaignTerminalStatus distingue sucesso vs só falha', () => {
    expect(resolveCampaignTerminalStatus({ successCount: 1, failCount: 0 })).toBe(
      CampaignStatus.COMPLETED
    );
    expect(resolveCampaignTerminalStatus({ successCount: 0, failCount: 2 })).toBe(
      CampaignStatus.FAILED
    );
    expect(resolveCampaignTerminalStatus({ successCount: 0, failCount: 0 })).toBe(
      CampaignStatus.FAILED
    );
    expect(
      resolveCampaignTerminalStatus({ successCount: 0, failCount: 0, skipCount: 3 })
    ).toBe(CampaignStatus.COMPLETED);
  });
});

describe('campaignStatusAfterProgress', () => {
  it('não devolve campanha pausada para executando', () => {
    expect(campaignStatusAfterProgress(CampaignStatus.PAUSED)).toBe(CampaignStatus.PAUSED);
    expect(campaignStatusAfterProgress(CampaignStatus.SCHEDULED)).toBe(CampaignStatus.SCHEDULED);
    expect(campaignStatusAfterProgress(CampaignStatus.WAITING_REPLY)).toBe(CampaignStatus.WAITING_REPLY);
    expect(campaignStatusAfterProgress(CampaignStatus.RUNNING)).toBe(CampaignStatus.RUNNING);
    expect(campaignStatusAfterProgress(CampaignStatus.DRAFT)).toBe(CampaignStatus.RUNNING);
  });
});

describe('mergeCampaignMetricsWithReport', () => {
  it('não infla progresso com linhas PENDING da lista', () => {
    const base = getCampaignProgressMetrics(
      baseCampaign({
        totalContacts: 5662,
        successCount: 34,
        processedCount: 34,
        failedCount: 0,
        status: CampaignStatus.PAUSED
      })
    );
    const merged = mergeCampaignMetricsWithReport(base, {
      totalRows: 5662,
      failedCount: 0,
      pendingCount: 5628,
      processedRows: 34
    });
    expect(merged.effectiveProcessed).toBe(34);
    expect(merged.pending).toBe(5662 - 34);
    expect(merged.progressPct).toBe(1); // 34/5662 ≈ 0.6% → arredonda 1
    expect(merged.ok).toBe(34);
  });
});
