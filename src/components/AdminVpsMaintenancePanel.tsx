import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionUser } from '../types/sessionUser';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardCopy,
  Database,
  RefreshCw,
  Terminal
} from 'lucide-react';
import toast from 'react-hot-toast';
import { CollapsibleSection, Badge, Button, StatTile } from './ui';
import { apiUrl } from '../utils/apiBase';

type VpsMaintenancePayload = {
  ok: boolean;
  at: string;
  operatingStatus: 'normal' | 'alert' | 'unknown';
  incidentNote: string;
  maintenance: {
    incidentNote?: string;
    automatic: {
      cronName: string;
      schedule: string;
      scheduleHuman: string;
      logPath: string;
      alertLogPath: string;
      cronMarker: string;
    };
    manual: {
      description: string;
      fullMonitor: string;
      quickCheck: string;
    };
    alertRules: string[];
    targets: { load15Ideal: number; postgresCpuNormal: number };
  };
  lastSnapshot: {
    at: string;
    source?: string;
    ok: boolean;
    issueCount: number;
    fixCount: number;
    evolutionRecovered?: boolean;
    load1: number;
    load15: number;
    cpus: number;
    diskPct: number;
    diskFree: string;
    evolutionUp: boolean;
    indexOk: boolean;
    healthHttp: number;
    postgresCpuPct: number | null;
    containers: { name: string; up: boolean }[];
    alerts: string[];
  } | null;
  snapshotStale: boolean;
  snapshotAgeHours: number | null;
  live: {
    load1: number;
    load5: number;
    load15: number;
    cpus: number;
    indexOk: boolean | null;
  };
  alerts: { level: 'warn' | 'critical'; code: string; message: string }[];
  error?: string;
};

function statusLabel(status: VpsMaintenancePayload['operatingStatus']): string {
  if (status === 'normal') return 'Operação normal';
  if (status === 'alert') return 'Alerta ativo';
  return 'Aguardando primeiro check';
}

function statusVariant(status: VpsMaintenancePayload['operatingStatus']): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'normal') return 'success';
  if (status === 'alert') return 'danger';
  return 'info';
}

async function copyText(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  } catch {
    toast.error('Não foi possível copiar');
  }
}

const Metric: React.FC<{ label: string; value: React.ReactNode; hint?: string; warn?: boolean }> = ({
  label,
  value,
  hint,
  warn
}) => <StatTile label={label} value={value} hint={hint} warn={warn} />;

export const AdminVpsMaintenancePanel: React.FC<{ user: SessionUser | null }> = ({ user }) => {
  const [data, setData] = useState<VpsMaintenancePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const token = await user.getIdToken();
      const r = await fetch(apiUrl('/api/admin/vps-maintenance'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const j = (await r.json()) as VpsMaintenancePayload;
      if (!r.ok) {
        setErr(j.error || `HTTP ${r.status}`);
        setData(null);
        return;
      }
      setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha de rede');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    load();
    const id = window.setInterval(load, 45_000);
    return () => clearInterval(id);
  }, [user, load]);

  const badge = useMemo(() => (data ? statusVariant(data.operatingStatus) : 'info'), [data]);

  if (!user) return null;

  const snap = data?.lastSnapshot;
  const live = data?.live;

  return (
    <CollapsibleSection
      title="Manutenção da VPS"
      summary={data ? statusLabel(data.operatingStatus) : 'Monitor semanal'}
      defaultOpen
      actions={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={load}
          loading={loading}
          leftIcon={<RefreshCw className="w-3.5 h-3.5" aria-hidden />}
        >
          <span className="hidden sm:inline">Atualizar</span>
        </Button>
      }
    >
      <div className="space-y-4">
        {err && (
          <div
            className="rounded-2xl px-4 py-3 text-[12px] border flex items-start gap-3"
            style={{
              background: 'var(--semantic-danger-bg)',
              borderColor: 'var(--semantic-danger-border)',
              color: 'var(--text-2)'
            }}
            role="alert"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--semantic-danger-fg)' }} aria-hidden />
            <span>{err}</span>
          </div>
        )}

        {data && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge dot variant={badge}>
                {statusLabel(data.operatingStatus)}
              </Badge>
              {data.snapshotStale && (
                <Badge variant="warning">
                  Check desatualizado{data.snapshotAgeHours != null ? ` (${data.snapshotAgeHours}h)` : ''}
                </Badge>
              )}
            </div>
            <p className="ui-body flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden />
              {data.incidentNote}
            </p>

            {data.alerts.length > 0 && (
              <ul className="space-y-2" aria-label="Alertas de manutenção">
                {data.alerts.map((a, i) => (
                  <li
                    key={`${a.code}-${i}`}
                    className="rounded-2xl px-4 py-3 text-[12px] flex gap-3"
                    style={{
                      background: a.level === 'critical' ? 'var(--semantic-danger-bg)' : 'var(--semantic-warning-bg)',
                      border: `1px solid ${a.level === 'critical' ? 'var(--semantic-danger-border)' : 'var(--semantic-warning-border)'}`
                    }}
                  >
                    <AlertTriangle
                      className="w-4 h-4 shrink-0 mt-0.5"
                      style={{ color: a.level === 'critical' ? 'var(--semantic-danger-fg)' : 'var(--warning)' }}
                      aria-hidden
                    />
                    <span style={{ color: 'var(--text-2)' }}>{a.message}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="zm-panel-grid zm-panel-grid--2">
              <div className="zm-panel space-y-3">
                <span className="ui-overline flex items-center gap-1.5">
                  <CalendarClock className="w-3.5 h-3.5" aria-hidden />
                  Automático
                </span>
                <StatTile
                  label="Cron"
                  value={data.maintenance.automatic.scheduleHuman}
                  hint={data.maintenance.automatic.cronName}
                />
              </div>

              <div className="zm-panel space-y-3">
                <span className="ui-overline flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" aria-hidden />
                  Manual
                </span>
                <p className="ui-caption">{data.maintenance.manual.description}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    leftIcon={<ClipboardCopy className="w-3.5 h-3.5" aria-hidden />}
                    onClick={() => void copyText(data.maintenance.manual.fullMonitor, 'Monitor completo')}
                  >
                    Copiar monitor
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    leftIcon={<ClipboardCopy className="w-3.5 h-3.5" aria-hidden />}
                    onClick={() => void copyText(data.maintenance.manual.quickCheck, 'Check rápido')}
                  >
                    Copiar check
                  </Button>
                </div>
              </div>
            </div>

            <div className="zm-stat-grid zm-stat-grid--4">
                <Metric
                  label="Load 1m (live)"
                  value={live ? live.load1.toFixed(2) : '—'}
                  hint={live ? `15m: ${live.load15.toFixed(2)} · meta < ${data.maintenance.targets.load15Ideal}` : undefined}
                  warn={live != null && live.load1 > 4}
                />
                <Metric
                  label="Postgres CPU"
                  value={snap?.postgresCpuPct != null ? `${snap.postgresCpuPct.toFixed(1)}%` : '—'}
                  hint={
                    snap
                      ? `Último check · normal < ${data.maintenance.targets.postgresCpuNormal}%`
                      : 'Rode o monitor na VPS'
                  }
                  warn={snap?.postgresCpuPct != null && snap.postgresCpuPct > 80}
                />
                <Metric
                  label="Índice Evolution"
                  value={
                    live?.indexOk === true || snap?.indexOk
                      ? 'OK'
                      : live?.indexOk === false || snap?.indexOk === false
                        ? 'Ausente'
                        : '—'
                  }
                  hint="idx_message_instance_remote_jid_ts"
                  warn={live?.indexOk === false || snap?.indexOk === false}
                />
                <Metric
                  label="Disco /"
                  value={snap ? `${snap.diskPct}%` : '—'}
                  hint={snap?.diskFree ? `${snap.diskFree} livre` : undefined}
                  warn={snap != null && snap.diskPct > 70}
                />
            </div>

            <details className="ui-caption">
              <summary className="cursor-pointer flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
                <Database className="w-3.5 h-3.5" aria-hidden />
                Regras de alerta
              </summary>
              <ul className="mt-2 pl-4 list-disc space-y-1 zm-panel">
                {data.maintenance.alertRules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </details>

            {snap && (
              <div className="zm-panel space-y-2">
                <p className="ui-overline">Último check ({snap.source === 'manual' ? 'manual' : 'cron'})</p>
                <p className="ui-caption">
                  {new Date(snap.at).toLocaleString('pt-BR')} ·{' '}
                  {snap.ok ? 'OK' : `${snap.issueCount} alerta(s)`}
                  {snap.evolutionRecovered ? ' · Evolution recuperado' : ''}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {snap.containers.map((c) => (
                    <Badge key={c.name} variant={c.up ? 'success' : 'danger'}>
                      {c.name.replace('zapmass-', '').replace('-1', '')}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {!snap && (
              <p className="ui-caption text-center py-2">
                Rode na VPS: <code>sudo bash /opt/zapmass/deployment/vps-monitor-producao.sh</code>
              </p>
            )}
          </>
        )}
      </div>
    </CollapsibleSection>
  );
};
