import { describe, expect, it } from 'vitest';
import { buildStageRepliesByPhone } from './campaignStageRepliesFromLogs';
import {
  CAMPAIGN_REPLY_LOG_MESSAGE,
  CAMPAIGN_SENT_LOG_MESSAGE
} from './campaignReportFromLogs';

describe('buildStageRepliesByPhone', () => {
  const phone = '5547999127001';

  it('retorna resposta de cada etapa com currentStep', () => {
    const logs = [
      {
        timestamp: '2026-06-04T23:15:38Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_SENT_LOG_MESSAGE, to: phone, replyFlowStep: 1 }
      },
      {
        timestamp: '2026-06-04T23:15:47Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_REPLY_LOG_MESSAGE,
          to: phone,
          currentStep: 1,
          replyPreview: 'oi'
        }
      },
      {
        timestamp: '2026-06-04T23:15:55Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_SENT_LOG_MESSAGE, to: phone, replyFlowStep: 2 }
      },
      {
        timestamp: '2026-06-04T23:16:02Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_REPLY_LOG_MESSAGE,
          to: phone,
          currentStep: 2,
          replyPreview: 'blz'
        }
      }
    ];
    const map = buildStageRepliesByPhone('c1', 2, logs);
    const rows = map.get(phone);
    expect(rows).toHaveLength(2);
    expect(rows?.[0]).toMatchObject({ stageNumber: 1, replyText: 'oi' });
    expect(rows?.[1]).toMatchObject({ stageNumber: 2, replyText: 'blz' });
  });

  it('deduplica log duplo na mesma etapa (contato + fluxo)', () => {
    const logs = [
      {
        timestamp: '2026-06-04T23:15:38Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_SENT_LOG_MESSAGE, to: phone, replyFlowStep: 1 }
      },
      {
        timestamp: '2026-06-04T23:15:47Z',
        payload: { campaignId: 'c1', message: 'Resposta do contato', to: phone, replyPreview: 'oi' }
      },
      {
        timestamp: '2026-06-04T23:15:47Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_REPLY_LOG_MESSAGE,
          to: phone,
          currentStep: 1,
          replyPreview: 'oi'
        }
      }
    ];
    const map = buildStageRepliesByPhone('c1', 2, logs);
    expect(map.get(phone)).toHaveLength(1);
    expect(map.get(phone)?.[0].replyText).toBe('oi');
  });
});
