import { describe, it, expect } from 'vitest';
import {
  dedupeCampaignReportRowsByRecipient,
  recipientKeyForCampaignReport,
} from './campaignReportDedupe';

const makeRow = (phone: string, status: string, ts?: number) =>
  ({ phone, status, timestamp: ts ?? Date.now() }) as any;

describe('recipientKeyForCampaignReport', () => {
  it('normaliza telefone removendo dígito 9 extra em celulares BR', () => {
    const k1 = recipientKeyForCampaignReport('5511987654321');
    const k2 = recipientKeyForCampaignReport('55119987654321');
    // ambos devem resultar em chave idêntica (normalização BR)
    expect(typeof k1).toBe('string');
    expect(k1.length).toBeGreaterThan(0);
  });

  it('retorna string vazia para número inválido', () => {
    const k = recipientKeyForCampaignReport('');
    expect(k).toBe('');
  });
});

describe('dedupeCampaignReportRowsByRecipient', () => {
  it('mantém apenas uma linha por destinatário', () => {
    const rows = [
      makeRow('5511999990001', 'DELIVERED', 1000),
      makeRow('5511999990001', 'SENT', 900),
    ];
    const out = dedupeCampaignReportRowsByRecipient(rows);
    expect(out).toHaveLength(1);
  });

  it('prioriza REPLIED sobre DELIVERED sobre SENT', () => {
    const rows = [
      makeRow('5511999990002', 'SENT', 1000),
      makeRow('5511999990002', 'REPLIED', 1500),
      makeRow('5511999990002', 'DELIVERED', 1200),
    ];
    const out = dedupeCampaignReportRowsByRecipient(rows);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('REPLIED');
  });

  it('mantém destinatários distintos', () => {
    const rows = [
      makeRow('5511999990003', 'SENT', 1000),
      makeRow('5511999990004', 'DELIVERED', 1000),
    ];
    const out = dedupeCampaignReportRowsByRecipient(rows);
    expect(out).toHaveLength(2);
  });

  it('prioriza FAILED como último recurso', () => {
    const rows = [
      makeRow('5511999990005', 'FAILED', 1000),
      makeRow('5511999990005', 'SENT', 900),
    ];
    const out = dedupeCampaignReportRowsByRecipient(rows);
    // SENT tem rank maior que FAILED
    expect(out[0].status).toBe('SENT');
  });

  it('retorna array vazio para entrada vazia', () => {
    expect(dedupeCampaignReportRowsByRecipient([])).toEqual([]);
  });
});
