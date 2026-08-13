import { describe, expect, it } from 'vitest';
import {
  collectPlannedRecipientPhones,
  collectSentPhonesFromCampaignLogs,
  isPhoneInCampaignReportScope
} from './campaignReportScope';
import { CAMPAIGN_SENT_LOG_MESSAGE } from './campaignReportFromLogs';

describe('campaignReportScope', () => {
  it('sentPhones define o escopo quando há envio', () => {
    const logs = [
      {
        timestamp: '2026-06-01T10:00:00Z',
        payload: { campaignId: 'c1', message: CAMPAIGN_SENT_LOG_MESSAGE, to: '5511991227881' }
      }
    ];
    const sent = collectSentPhonesFromCampaignLogs(logs, 'c1');
    expect(sent.has('5511991227881')).toBe(true);
    expect(isPhoneInCampaignReportScope('5511888777666', sent, new Set())).toBe(false);
  });

  it('plannedPhones quando ainda não houve envio', () => {
    const planned = collectPlannedRecipientPhones(
      {
        contactListId: 'list1',
        scheduleStartSnapshot: { numbers: ['5511991227881'], message: 'oi' },
        totalContacts: 1
      },
      [],
      [{ id: 'list1', name: 'L', contactIds: [], createdAt: '' }]
    );
    expect(planned.has('5511991227881')).toBe(true);
    expect(isPhoneInCampaignReportScope('5511991227881', new Set(), planned)).toBe(true);
  });

  it('não mistura a lista ao vivo quando já existe snapshot do disparo', () => {
    const planned = collectPlannedRecipientPhones(
      {
        contactListId: 'list1',
        scheduleStartSnapshot: { numbers: ['5511991227881'], message: 'oi' },
        totalContacts: 1
      },
      [
        { id: 'a', name: 'A', phone: '5511991227881' } as never,
        { id: 'b', name: 'B', phone: '5511888777666' } as never
      ],
      [{ id: 'list1', name: 'L', contactIds: ['a', 'b'], createdAt: '' }]
    );
    expect(planned.has('5511991227881')).toBe(true);
    expect(planned.has('5511888777666')).toBe(false);
    expect(planned.size).toBe(1);
  });
});
