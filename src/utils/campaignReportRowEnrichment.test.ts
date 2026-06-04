import { describe, expect, it } from 'vitest';
import { enrichCampaignReportRow } from './campaignReportRowEnrichment';
import { CAMPAIGN_CONTACT_REPLY_LOG_MESSAGE } from './campaignReportFromLogs';

describe('enrichCampaignReportRow', () => {
  it('promove para REPLIED quando há log de resposta sem texto no chat', () => {
    const row = enrichCampaignReportRow(
      {
        phone: '5511991227881',
        status: 'SENT',
        sentTimestampMs: 1000
      },
      {
        campaignId: 'c1',
        replyHint: {
          phone: '5511991227881',
          replyTimestampMs: 2000,
          replyText: 'Oi, tudo bem?'
        },
        scopedLogs: [
          {
            timestamp: '2026-06-01T12:00:00Z',
            payload: {
              campaignId: 'c1',
              message: CAMPAIGN_CONTACT_REPLY_LOG_MESSAGE,
              to: '5511991227881',
              replyPreview: 'Oi, tudo bem?'
            }
          }
        ],
        conversations: [],
        allowedConnectionIds: []
      }
    );
    expect(row.status).toBe('REPLIED');
    expect(row.replyText).toBe('Oi, tudo bem?');
  });
});
