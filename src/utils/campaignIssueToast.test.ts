import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  resetCampaignRecipientErrorBurst,
  scheduleCampaignRecipientErrorDigest,
  type CampaignErrorBurstState,
} from './campaignIssueToast';

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
  },
}));

describe('campaignIssueToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('agrupa várias falhas do mesmo destinatário em um único total no flush', () => {
    const stateRef: { current: CampaignErrorBurstState } = {
      current: {
        pending: 0,
        timer: null,
        lastToastAt: 0,
        announcedTotal: 0,
      },
    };
    resetCampaignRecipientErrorBurst(stateRef);
    scheduleCampaignRecipientErrorDigest(stateRef, 100, { phone: '5511999999999', reason: 'err' });
    scheduleCampaignRecipientErrorDigest(stateRef, 100, { phone: '5511999999999', reason: 'err' });
    scheduleCampaignRecipientErrorDigest(stateRef, 100, { phone: '5511999999999', reason: 'err' });
    vi.advanceTimersByTime(150);
    expect(stateRef.current.announcedTotal).toBe(3);
    expect(stateRef.current.pending).toBe(0);
  });
});
