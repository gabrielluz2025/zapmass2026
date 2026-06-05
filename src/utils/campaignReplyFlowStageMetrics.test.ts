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
    const stages = buildReplyFlowStageFunnels('c1', campaign, logs);
    expect(stages[0].sent).toBe(1);
    expect(stages[0].replied).toBe(1);
    expect(stages[0].delivered).toBe(1);
    expect(stages[0].read).toBe(1);
    expect(stages[0].replyPct).toBe(100);
  });

  it('conta resposta no fluxo sem currentStep (usa timestamp do envio)', () => {
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
    const stages = buildReplyFlowStageFunnels('c1', campaign, logs);
    expect(stages[0].replied).toBe(1);
    expect(stages[0].delivered).toBe(1);
    expect(stages[0].read).toBe(1);
  });

  it('atribui respostas por etapa com dois envios (fluxo completo)', () => {
    const phone = '5547999127001';
    const logs = [
      {
        timestamp: '2026-06-04T19:50:24Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_SENT_LOG_MESSAGE, to: phone, replyFlowStep: 1 }
      },
      {
        timestamp: '2026-06-04T19:50:34Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_REPLY_LOG_MESSAGE, to: phone, replyPreview: 'oi' }
      },
      {
        timestamp: '2026-06-04T19:50:41Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_SENT_LOG_MESSAGE, to: phone, replyFlowStep: 2 }
      },
      {
        timestamp: '2026-06-04T19:50:46Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_REPLY_LOG_MESSAGE, to: phone, replyPreview: 'ok' }
      }
    ];
    const stages = buildReplyFlowStageFunnels('c1', campaign, logs);
    expect(stages[0].sent).toBe(1);
    expect(stages[0].replied).toBe(1);
    expect(stages[0].replyPct).toBe(100);
    expect(stages[1].sent).toBe(1);
    expect(stages[1].replied).toBe(1);
    expect(stages[1].replyPct).toBe(100);
  });

  it('duas etapas com currentStep: resposta na etapa 2 não conta na etapa 1', () => {
    const phone = '5511991227881';
    const logs = [
      {
        timestamp: '2026-06-01T17:18:00Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_SENT_LOG_MESSAGE, to: phone, replyFlowStep: 1 }
      },
      {
        timestamp: '2026-06-01T17:18:10Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_REPLY_LOG_MESSAGE,
          to: phone,
          currentStep: 1,
          replyPreview: 'a'
        }
      },
      {
        timestamp: '2026-06-01T17:19:00Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_SENT_LOG_MESSAGE, to: phone, replyFlowStep: 2 }
      },
      {
        timestamp: '2026-06-01T17:19:10Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_REPLY_LOG_MESSAGE,
          to: phone,
          currentStep: 2,
          replyPreview: 'b'
        }
      }
    ];
    const stages = buildReplyFlowStageFunnels('c1', campaign, logs);
    expect(stages[0].replied).toBe(1);
    expect(stages[1].replied).toBe(1);
    expect(stages[1].delivered).toBe(1);
  });

  it('dois contatos: só um completa etapa 2', () => {
    const campaign2 = {
      ...campaign,
      totalContacts: 2
    };
    const phoneA = '5511111111111';
    const phoneB = '5522222222222';
    const logs = [
      {
        timestamp: '2026-06-01T10:00:00Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_SENT_LOG_MESSAGE, to: phoneA, replyFlowStep: 1 }
      },
      {
        timestamp: '2026-06-01T10:00:01Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_SENT_LOG_MESSAGE, to: phoneB, replyFlowStep: 1 }
      },
      {
        timestamp: '2026-06-01T10:01:00Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_REPLY_LOG_MESSAGE,
          to: phoneA,
          currentStep: 1
        }
      },
      {
        timestamp: '2026-06-01T10:02:00Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_SENT_LOG_MESSAGE, to: phoneA, replyFlowStep: 2 }
      },
      {
        timestamp: '2026-06-01T10:03:00Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_REPLY_LOG_MESSAGE,
          to: phoneA,
          currentStep: 2
        }
      }
    ];
    const stages = buildReplyFlowStageFunnels('c1', campaign2, logs);
    expect(stages[0].sent).toBe(2);
    expect(stages[0].replied).toBe(1);
    expect(stages[1].sent).toBe(1);
    expect(stages[1].replied).toBe(1);
  });

  it('resposta com currentStep apos envios nas duas etapas', () => {
    const phone = '552799127881';
    const logs = [
      {
        timestamp: '2026-06-04T18:41:18Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_SENT_LOG_MESSAGE, to: phone, replyFlowStep: 1 }
      },
      {
        timestamp: '2026-06-04T18:41:24Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_REPLY_LOG_MESSAGE,
          to: phone,
          currentStep: 1,
          replyPreview: '9'
        }
      },
      {
        timestamp: '2026-06-04T18:41:30Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_SENT_LOG_MESSAGE, to: phone, replyFlowStep: 2 }
      },
      {
        timestamp: '2026-06-04T18:41:37Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_REPLY_LOG_MESSAGE,
          to: phone,
          currentStep: 2,
          replyPreview: 'ok'
        }
      }
    ];
    const stages = buildReplyFlowStageFunnels('c1', campaign, logs);
    expect(stages[0].sent).toBe(1);
    expect(stages[0].replied).toBe(1);
    expect(stages[0].deliveryPct).toBe(100);
    expect(stages[1].sent).toBe(1);
    expect(stages[1].replied).toBe(1);
    expect(stages[1].replyPct).toBe(100);
  });

  it('hints de resposta atribuem etapa 2 pelo timestamp do envio', () => {
    const phone = '5547999127001';
    const logs = [
      {
        timestamp: '2026-06-04T19:50:24Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_SENT_LOG_MESSAGE, to: phone, replyFlowStep: 1 }
      },
      {
        timestamp: '2026-06-04T19:50:41Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_SENT_LOG_MESSAGE, to: phone, replyFlowStep: 2 }
      }
    ];
    const hints = new Map([
      [
        phone,
        { phone, replyTimestampMs: new Date('2026-06-04T19:50:46Z').getTime(), replyText: 'ok' }
      ]
    ]);
    const stages = buildReplyFlowStageFunnels('c1', campaign, logs, hints);
    expect(stages[0].sent).toBe(1);
    expect(stages[1].sent).toBe(1);
    expect(stages[1].replied).toBe(1);
    expect(stages[1].replyPct).toBe(100);
  });

  it('envio sem resposta ainda mostra entregue (lida/resposta 0)', () => {
    const logs = [
      {
        timestamp: '2026-06-01T17:18:00Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_SENT_LOG_MESSAGE,
          to: '5511991227881',
          replyFlowStep: 1
        }
      }
    ];
    const stages = buildReplyFlowStageFunnels('c1', campaign, logs);
    expect(stages[0].sent).toBe(1);
    expect(stages[0].delivered).toBe(1);
    expect(stages[0].deliveryPct).toBe(100);
    expect(stages[0].read).toBe(0);
    expect(stages[0].replied).toBe(0);
  });

  it('resposta só com replyPreview e currentStep (message vazio no payload)', () => {
    const phone = '552799127881';
    const logs = [
      {
        timestamp: '2026-06-04T18:41:18Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_SENT_LOG_MESSAGE, to: phone, replyFlowStep: 1 }
      },
      {
        timestamp: '2026-06-04T18:41:24Z',
        payload: { campaignId: 'c1', message: '', to: phone, replyPreview: '9', currentStep: 1 }
      },
      {
        timestamp: '2026-06-04T18:41:30Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_SENT_LOG_MESSAGE, to: phone, replyFlowStep: 2 }
      },
      {
        timestamp: '2026-06-04T18:41:37Z',
        payload: { campaignId: 'c1', message: '', to: phone, replyPreview: 'ok', currentStep: 2 }
      }
    ];
    const stages = buildReplyFlowStageFunnels('c1', campaign, logs);
    expect(stages[0].replied).toBe(1);
    expect(stages[0].readPct).toBe(100);
    expect(stages[1].replied).toBe(1);
    expect(stages[1].replyPct).toBe(100);
  });

  it('conta resposta quando envio e resposta usam formatos diferentes do mesmo número', () => {
    const logs = [
      {
        timestamp: '2026-06-04T23:15:38Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_SENT_LOG_MESSAGE,
          to: '5547999127001',
          replyFlowStep: 1
        }
      },
      {
        timestamp: '2026-06-04T23:15:47Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_REPLY_LOG_MESSAGE,
          to: '554799127001',
          currentStep: 1,
          replyPreview: 'oi'
        }
      },
      {
        timestamp: '2026-06-04T23:15:55Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_SENT_LOG_MESSAGE,
          to: '5547999127001',
          replyFlowStep: 2
        }
      },
      {
        timestamp: '2026-06-04T23:16:02Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_REPLY_LOG_MESSAGE,
          to: '554799127001',
          currentStep: 2,
          replyPreview: 'ok'
        }
      }
    ];
    const stages = buildReplyFlowStageFunnels('c1', campaign, logs);
    expect(stages[0].replied).toBe(1);
    expect(stages[0].replyPct).toBe(100);
    expect(stages[1].replied).toBe(1);
    expect(stages[1].replyPct).toBe(100);
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
    const stages = buildReplyFlowStageFunnels('c1', campaign, logs);
    expect(stages[0].sent).toBe(1);
    expect(stages[0].replied).toBe(1);
    expect(stages[0].delivered).toBe(1);
  });
});
