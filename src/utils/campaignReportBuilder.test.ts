import { describe, expect, it } from 'vitest';
import { buildPrimaryReportRowsFromLogs } from './campaignReportBuilder';
import {
  CAMPAIGN_CONTACT_REPLY_LOG_MESSAGE,
  CAMPAIGN_REPLY_LOG_MESSAGE,
  CAMPAIGN_SENT_LOG_MESSAGE
} from './campaignReportFromLogs';

const campaign = {
  contactListId: '',
  scheduleStartSnapshot: { numbers: ['5547999127001'], message: 'oi' },
  totalContacts: 1
};

describe('buildPrimaryReportRowsFromLogs', () => {
  it('marca REPLIED e texto quando há logs de resposta', () => {
    const logs = [
      {
        timestamp: '2026-06-04T20:05:14Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_SENT_LOG_MESSAGE,
          to: '5547999127001',
          replyFlowStep: 1
        }
      },
      {
        timestamp: '2026-06-04T20:05:19Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_REPLY_LOG_MESSAGE,
          to: '5547999127001',
          replyPreview: 'oi'
        }
      },
      {
        timestamp: '2026-06-04T20:05:26Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_SENT_LOG_MESSAGE,
          to: '5547999127001',
          replyFlowStep: 2
        }
      },
      {
        timestamp: '2026-06-04T20:05:29Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_CONTACT_REPLY_LOG_MESSAGE,
          to: '5547999127001',
          replyPreview: 'ok'
        }
      }
    ];
    const rows = buildPrimaryReportRowsFromLogs(logs, 'c1', [], campaign, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('REPLIED');
    expect(rows[0].replyText).toBe('ok');
    expect(rows[0].replyTime).toBeTruthy();
  });

  it('nao duplica linha por numero planejado se ja houve envio em outro formato', () => {
    const logs = [
      {
        timestamp: '2026-06-04T18:41:18Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_SENT_LOG_MESSAGE,
          to: '552799127881'
        }
      },
      {
        timestamp: '2026-06-04T18:41:24Z',
        payload: {
          campaignId: 'c1',
          message: CAMPAIGN_REPLY_LOG_MESSAGE,
          to: '552799127881',
          replyPreview: '9'
        }
      }
    ];
    const camp = {
      contactListId: '',
      scheduleStartSnapshot: {
        numbers: ['552799127881', '2799127881'],
        message: 'oi'
      },
      totalContacts: 1
    };
    const rows = buildPrimaryReportRowsFromLogs(logs, 'c1', [], camp, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('REPLIED');
  });
});
