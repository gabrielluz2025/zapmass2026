import { describe, expect, it } from 'vitest';
import {
  buildVpsMaintenanceAlerts,
  resolveOperatingStatus,
  type VpsHealthSnapshot
} from './vpsMaintenance.js';

const baseSnapshot = (over: Partial<VpsHealthSnapshot> = {}): VpsHealthSnapshot => ({
  at: '2026-06-25T11:48:00+00:00',
  ok: true,
  issueCount: 0,
  fixCount: 0,
  load1: 2.1,
  load15: 2.0,
  cpus: 4,
  diskPct: 40,
  diskFree: '50G',
  evolutionUp: true,
  indexOk: true,
  healthHttp: 200,
  postgresCpuPct: 0.01,
  containers: [],
  alerts: [],
  cronSchedule: '0 9 * * 1',
  cronMarker: '/etc/cron.d/zapmass-monitor-producao',
  ...over
});

describe('buildVpsMaintenanceAlerts', () => {
  it('alerta load acima do limiar', () => {
    const alerts = buildVpsMaintenanceAlerts({
      load1: 5.2,
      snapshot: null,
      indexOkLive: true
    });
    expect(alerts.some((a) => a.code === 'load')).toBe(true);
  });

  it('alerta postgres cpu alto com evolution up no snapshot', () => {
    const alerts = buildVpsMaintenanceAlerts({
      load1: 2,
      snapshot: baseSnapshot({ postgresCpuPct: 133, evolutionUp: true }),
      indexOkLive: true
    });
    expect(alerts.some((a) => a.code === 'postgres_cpu')).toBe(true);
  });

  it('sem alertas em estado saudável', () => {
    const alerts = buildVpsMaintenanceAlerts({
      load1: 2,
      snapshot: baseSnapshot(),
      indexOkLive: true
    });
    expect(alerts).toHaveLength(0);
  });
});

describe('resolveOperatingStatus', () => {
  it('normal quando índice live ok sem snapshot', () => {
    expect(resolveOperatingStatus([], null, true)).toBe('normal');
  });

  it('unknown sem dados', () => {
    expect(resolveOperatingStatus([], null, null)).toBe('unknown');
  });
});
