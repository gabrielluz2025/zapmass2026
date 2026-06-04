import { describe, expect, it } from 'vitest';
import {
  aggregateFunnelFromReportRows,
  clampCampaignFunnelMetrics,
  funnelPct
} from './campaignFunnelMetrics';

describe('clampCampaignFunnelMetrics', () => {
  it('limita entregue, lida e resposta ao número de enviadas', () => {
    expect(clampCampaignFunnelMetrics(1, 5, 3, 4)).toEqual({
      sent: 1,
      delivered: 1,
      read: 1,
      replied: 1
    });
  });

  it('infere entregue e lida a partir de respostas', () => {
    expect(clampCampaignFunnelMetrics(5, 0, 0, 4)).toEqual({
      sent: 5,
      delivered: 4,
      read: 4,
      replied: 4
    });
  });

  it('mantém funil monotônico válido', () => {
    expect(clampCampaignFunnelMetrics(10, 8, 6, 3)).toEqual({
      sent: 10,
      delivered: 8,
      read: 6,
      replied: 3
    });
  });
});

describe('aggregateFunnelFromReportRows', () => {
  it('conta entregue/lida a partir de REPLIED', () => {
    expect(
      aggregateFunnelFromReportRows([
        { status: 'REPLIED' },
        { status: 'REPLIED' },
        { status: 'SENT' }
      ])
    ).toEqual({ sent: 3, delivered: 2, read: 2, replied: 2 });
  });
});

describe('funnelPct', () => {
  it('retorna 0 sem denominador', () => {
    expect(funnelPct(4, 0)).toBe(0);
  });

  it('arredonda percentual sobre envios', () => {
    expect(funnelPct(1, 4)).toBe(25);
  });
});
