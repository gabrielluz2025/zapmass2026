import { describe, expect, it } from 'vitest';
import { computeAccountDashboardSummary, computeAdminOpsSnapshot } from './dashboardAccountSummary';
import { CampaignStatus, ConnectionStatus } from '../types';

describe('dashboardAccountSummary', () => {
  it('resume envios, campanhas e lembretes da conta', () => {
    const summary = computeAccountDashboardSummary(
      [
        { id: 'c1', status: ConnectionStatus.CONNECTED, messagesSentToday: 12, queueSize: 2 } as never,
        { id: 'c2', status: ConnectionStatus.DISCONNECTED, messagesSentToday: 0 } as never
      ],
      [
        { id: 'p1', status: CampaignStatus.RUNNING } as never,
        { id: 'p2', status: CampaignStatus.SCHEDULED } as never
      ],
      [{ id: 'u1', followUpAt: new Date().toISOString() } as never],
      ['c2']
    );
    expect(summary.sentToday).toBe(12);
    expect(summary.onlineChannels).toBe(1);
    expect(summary.runningCampaigns).toBe(1);
    expect(summary.scheduledCampaigns).toBe(1);
    expect(summary.followUpsToday).toBe(1);
    expect(summary.pausedChannels).toBe(1);
  });

  it('resume metricas rapidas de operacoes', () => {
    const ops = computeAdminOpsSnapshot(
      [{ id: 'c1', status: ConnectionStatus.DISCONNECTED, queueSize: 5 } as never],
      { ram: 72, ramTotalGb: 8, latency: 120 } as never
    );
    expect(ops.offlineChannels).toBe(1);
    expect(ops.queueTotal).toBe(5);
    expect(ops.ramPct).toBe(72);
    expect(ops.latencyMs).toBe(120);
  });
});
