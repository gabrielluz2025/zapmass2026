import { describe, expect, it } from 'vitest';
import { buildReplyFlowStageFunnels } from './campaignReplyFlowStageMetrics';
import {
  CAMPAIGN_CONTACT_REPLY_LOG_MESSAGE,
  CAMPAIGN_REPLY_LOG_MESSAGE,
  CAMPAIGN_SENT_LOG_MESSAGE
} from './campaignReportFromLogs';

const campaign = {
  replyFlow: {
    enabled: true,
    steps: [{ body: 'Oi', acceptAnyReply: true }, { body: 'Etapa 2' }]
  },
  totalContacts: 1
};

describe('buildReplyFlowStageFunnels', () => {
  it('resposta na etapa implica entregue e lida (mesmo relatório só SENT)', () => {
    const logs = [
      {
        timestamp: '2026-06-01T17:18:00Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_SENT_LOG_MESSAGE,
          to: '5511991227881',
          replyFlowStep: 1
        }
      },
      {
        timestamp: '2026-06-01T17:28:00Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_CONTACT_REPLY_LOG_MESSAGE,
          to: '5511991227881',
          replyPreview: 'Oi'
        }
      }
    ];
    const stages = buildReplyFlowStageFunnels('c1', campaign, logs, [
      { phone: '5511991227881', status: 'SENT' }
    ]);
    expect(stages[0].sent).toBe(1);
    expect(stages[0].replied).toBe(1);
    expect(stages[0].delivered).toBe(1);
    expect(stages[0].read).toBe(1);
    expect(stages[0].replyPct).toBe(100);
  });

  it('conta resposta no fluxo sem currentStep (usa último envio da etapa)', () => {
    const logs = [
      {
        timestamp: '2026-06-01T17:18:00Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_SENT_LOG_MESSAGE,
          to: '5511991227881',
          replyFlowStep: 1
        }
      },
      {
        timestamp: '2026-06-01T17:18:10Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_REPLY_LOG_MESSAGE,
          to: '5511991227881',
          replyPreview: 'sim'
        }
      }
    ];
    const stages = buildReplyFlowStageFunnels('c1', campaign, logs, [
      { phone: '5511991227881', status: 'SENT' }
    ]);
    expect(stages[0].replied).toBe(1);
    expect(stages[0].delivered).toBe(1);
    expect(stages[0].read).toBe(1);
  });

  it('não conta resposta de outra etapa sem envio correspondente', () => {
    const logs = [
      {
        timestamp: '2026-06-01T17:18:00Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_SENT_LOG_MESSAGE,
          to: '5511991227881',
          replyFlowStep: 1
        }
      },
      {
        timestamp: '2026-06-01T17:28:00Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_REPLY_LOG_MESSAGE,
          to: '5511991227881',
          currentStep: 1
        }
      },
      {
        timestamp: '2026-06-01T17:29:00Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_REPLY_LOG_MESSAGE,
          to: '5511888777666',
          currentStep: 1
        }
      }
    ];
    const stages = buildReplyFlowStageFunnels('c1', campaign, logs, []);
    expect(stages[0].sent).toBe(1);
    expect(stages[0].replied).toBe(1);
    expect(stages[0].delivered).toBe(1);
  });
});
