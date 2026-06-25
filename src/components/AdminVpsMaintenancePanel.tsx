import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionUser } from '../types/sessionUser';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardCopy,
  Database,
  RefreshCw,
  ServerCog,
  Terminal,
  Wrench
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Card, CardHeader, Badge, Button } from './ui';
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
}) => (
  <div
    className="flex flex-col gap-0.5 min-w-0 rounded-lg px-2.5 py-2"
    style={{
      background: 'var(--surface-2)',
      border: warn ? '1px solid var(--semantic-danger-border)' : '1px solid transparent'
    }}
  >
    <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
      {label}
    </span>
    <span className="text-[15px] font-semibold tabular-nums leading-tight" style={{ color: 'var(--text-1)' }}>
      {value}
    </span>
    {hint && (
      <span className="text-[10px] leading-snug" style={{ color: warn ? 'var(--semantic-danger-fg)' : 'var(--text-3)' }}>
        {hint}
      </span>
    )}
  </div>
);

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
    <Card
      className="overflow-hidden shadow-sm animate-fade-in-up"
      style={{
        background: 'linear-gradient(180deg, var(--ops-panel-fade) 0%, var(--surface-0) 48%)',
        borderColor: 'var(--border-subtle)'
      }}
    >
      <div className="p-1">
        <CardHeader
          icon={
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm"
              style={{ background: 'var(--semantic-success-tint)' }}
            >
              <Wrench className="w-[18px] h-[18px] text-emerald-600" aria-hidden />
            </div>
          }
          title="Manutenção da VPS"
          subtitle="Acompanhamento pós-incidente — cron semanal, checks manuais e limiares de alerta."
          actions={
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {data?.at && (
                <span className="text-[10px] tabular-nums hidden sm:inline" style={{ color: 'var(--text-3)' }}>
                  Atual.: {new Date(data.at).toLocaleTimeString('pt-BR')}
                </span>
              )}
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
            </div>
          }
        />
      </div>

      <div className="px-4 pb-5 pt-0 space-y-4">
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
            <div
              className="rounded-2xl px-4 py-3 space-y-2"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge dot variant={badge}>
                  {statusLabel(data.operatingStatus)}
                </Badge>
                {data.snapshotStale && (
                  <Badge variant="warning" className="text-[10px]">
                    Check completo desatualizado
                    {data.snapshotAgeHours != null ? ` (${data.snapshotAgeHours}h)` : ''}
                  </Badge>
                )}
              </div>
              <p className="text-[12px] leading-relaxed flex items-start gap-2" style={{ color: 'var(--text-2)' }}>
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden />
                {data.incidentNote}
              </p>
            </div>

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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div
                className="rounded-2xl p-4 space-y-3"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
              >
                <div className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
                  <CalendarClock className="w-4 h-4 text-sky-500 shrink-0" aria-hidden />
                  Automático
                </div>
                <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
                  Cron <code className="text-[11px]">zapmass-monitor-producao</code>
                </p>
                <Metric
                  label="Agendamento"
                  value={data.maintenance.automatic.scheduleHuman}
                  hint={`Expressão: ${data.maintenance.automatic.schedule} (UTC)`}
                />
                <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                  Log: {data.maintenance.automatic.logPath}
                  <br />
                  Alertas: {data.maintenance.automatic.alertLogPath}
                </p>
              </div>

              <div
                className="rounded-2xl p-4 space-y-3"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
              >
                <div className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
                  <Terminal className="w-4 h-4 text-violet-500 shrink-0" aria-hidden />
                  Manual (opcional)
                </div>
                <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {data.maintenance.manual.description}
                </p>
                <div className="space-y-2">
                  <div className="rounded-lg p-2.5 text-[10px] font-mono break-all" style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                    {data.maintenance.manual.fullMonitor}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    leftIcon={<ClipboardCopy className="w-3.5 h-3.5" aria-hidden />}
                    onClick={() => void copyText(data.maintenance.manual.fullMonitor, 'Monitor completo')}
                  >
                    Copiar monitor completo
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    leftIcon={<ClipboardCopy className="w-3.5 h-3.5" aria-hidden />}
                    onClick={() => void copyText(data.maintenance.manual.quickCheck, 'Check rápido')}
                  >
                    Copiar check rápido
                  </Button>
                </div>
              </div>
            </div>

            <div
              className="rounded-2xl p-4 space-y-3"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
                <ServerCog className="w-4 h-4 text-cyan-500 shrink-0" aria-hidden />
                Métricas
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
            </div>

            <div
              className="rounded-2xl p-4 space-y-2"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
                <Database className="w-4 h-4 text-amber-500 shrink-0" aria-hidden />
                Regras de alerta
              </div>
              <ul className="text-[11px] space-y-1 list-disc pl-4" style={{ color: 'var(--text-3)' }}>
                {data.maintenance.alertRules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>

            {snap && (
              <div
                className="rounded-2xl p-4 space-y-2"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
              >
                <p className="text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
                  Último check completo ({snap.source === 'manual' ? 'manual' : 'cron'})
                </p>
                <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                  {new Date(snap.at).toLocaleString('pt-BR')} ·{' '}
                  {snap.ok ? 'OK — 0 alertas' : `${snap.issueCount} alerta(s)`}
                  {snap.fixCount > 0 ? ` · ${snap.fixCount} correção(ões) auto` : ''}
                  {snap.evolutionRecovered ? ' · Evolution recuperado' : ''}
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {snap.containers.map((c) => (
                    <Badge key={c.name} variant={c.up ? 'success' : 'danger'} className="text-[10px]">
                      {c.name.replace('zapmass-', '').replace('-1', '')}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {!snap && (
              <p className="text-[11px] text-center py-2 leading-relaxed" style={{ color: 'var(--text-3)' }}>
                Ainda não há snapshot na VPS. Rode uma vez:{' '}
                <code className="text-[10px]">sudo bash /opt/zapmass/deployment/vps-monitor-producao.sh</code>
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
};
