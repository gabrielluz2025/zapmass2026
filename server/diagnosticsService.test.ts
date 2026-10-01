import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./repositories/campaignsRepository.js', () => ({
  listCampaigns: vi.fn(async () => [
    { id: 'camp-a', name: 'Camp A', status: 'RUNNING' },
  ]),
}));

vi.mock('./tenantDiagnosticBuffer.js', () => ({
  listTenantDiagnosticEvents: vi.fn(() => [
    {
      at: new Date().toISOString(),
      source: 'campaign' as const,
      level: 'warn' as const,
      code: 'other',
      codeLabel: 'Outro',
      message: 'teste',
      campaignId: 'orphan-x',
    },
  ]),
}));

vi.mock('./evolutionService.js', () => ({
  getConnections: vi.fn(() => [
    { id: 'tenant__chip1', name: 'Chip 1', status: 'CONNECTED', ownerUid: 'tenant' },
  ]),
  getTenantCampaignRuntimeSnapshots: vi.fn(() => [
    {
      campaignId: 'camp-a',
      isRunning: true,
      processed: 10,
      successCount: 8,
      failCount: 1,
      pendingJobs: 2,
      paused: false,
    },
    {
      campaignId: 'runtime-only',
      isRunning: true,
      processed: 1,
      successCount: 0,
      failCount: 0,
      pendingJobs: 0,
      paused: false,
    },
  ]),
  collectTenantCampaignQueueJobCounts: vi.fn(async () =>
    new Map([
      ['camp-a', 240],
      ['orphan-x', 3],
    ])
  ),
  getCampaignBullmqQueueMetrics: vi.fn(async () => ({
    enabled: true,
    waiting: 0,
    active: 9,
    delayed: 252,
    failed: 1,
    channelQueues: 4,
  })),
}));

describe('buildTenantDiagnosticsExport', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('usa conexões Evolution, vpsOnly por auth/data e enriquece campanhas/fila', async () => {
    process.env.ZAPMASS_AUTH_PROVIDER = 'vps';
    process.env.ZAPMASS_DATA_PROVIDER = 'vps';
    delete process.env.ZAPMASS_VPS_ONLY;

    const { buildTenantDiagnosticsExport } = await import('./diagnosticsService.js');
    const bundle = await buildTenantDiagnosticsExport('tenant');

    expect(bundle.configFlags.vpsOnly).toBe(true);
    expect(bundle.configFlags.authProvider).toBe('vps');
    expect(bundle.connections).toHaveLength(1);
    expect(bundle.connections[0].status).toBe('CONNECTED');

    const campA = bundle.campaigns.find((c) => c.id === 'camp-a');
    expect(campA?.queueJobs).toBe(240);
    expect(campA?.pendingJobs).toBe(2);

    expect(bundle.campaigns.some((c) => c.id === 'runtime-only' && c.runtimeOnly)).toBe(true);
    expect(bundle.orphanCampaignIdsFromErrors).toContain('orphan-x');
    expect(bundle.queue?.delayedLen).toBe(252);
    expect(bundle.queue?.channelQueues).toBe(4);
  });
});
