import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionUser } from '../types/sessionUser';
import { AlertTriangle, Cpu, HardDrive, Radio, RefreshCw, Wifi } from 'lucide-react';
import { CollapsibleSection, Badge, Button, RingGauge, StatTile } from './ui';
import { apiUrl } from '../utils/apiBase';

type AdminOpsSnapshot = {
  ok: boolean;
  at: string;
  scopeNote?: string;
  system: {
    cpu: number;
    ram: number;
    uptime: string;
    ramTotalGb: number;
    load1: number;
    load5: number;
    load15: number;
    cpus: number;
    processHeapMb: number;
    processRssMb: number;
    processUptimeSec: number;
  };
  sessionRouter: {
    commandsPublished: number;
    commandsCompleted: number;
    commandsFailed: number;
    pendingAssignments: number;
    aliveWorkers: number;
  };
  whatsapp: { connectedSessions: number; capacityHint: { safe: number; critical: number } };
  firebase: {
    configured: boolean;
    pingOk: boolean;
    latencyMs?: number;
    projectId?: string;
    error?: string;
  };
  alerts: { level: 'warn' | 'critical'; code: string; message: string }[];
  history: { t: number; ramPct: number; load1: number; cpu: number; heapMb: number }[];
  historyMeta?: { intervalMs: number; maxPoints: number; windowApproxHours: number };
};

function bucket24hRam(history: { t: number; ramPct: number }[]): number[] {
  if (history.length === 0) return Array(24).fill(0);
  const end = Date.now();
  const start = end - 24 * 60 * 60 * 1000;
  const slotMs = 60 * 60 * 1000;
  const out = new Array(24).fill(0);
  for (const p of history) {
    if (p.t < start || p.t > end) continue;
    const i = Math.min(23, Math.floor((p.t - start) / slotMs));
    out[i] = Math.max(out[i], p.ramPct);
  }
  return out;
}

function healthSummary(alerts: AdminOpsSnapshot['alerts']): { variant: 'success' | 'warning' | 'danger'; title: string; detail: string } {
  if (alerts.length === 0) {
    return { variant: 'success', title: 'Estado estável', detail: 'Nenhum limiar de alerta ativo neste painel' };
  }
  const crit = alerts.filter((a) => a.level === 'critical').length;
  const warn = alerts.filter((a) => a.level === 'warn').length;
  if (crit > 0) {
    return {
      variant: 'danger',
      title: crit === 1 ? '1 alerta crítico' : `${crit} alertas críticos`,
      detail: warn > 0 ? `e ${warn} aviso(s)` : ''
    };
  }
  return {
    variant: 'warning',
    title: warn === 1 ? '1 aviso' : `${warn} avisos`,
    detail: 'Rever métricas abaixo'
  };
}

const Metric: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({ label, value, hint }) => (
  <StatTile label={label} value={value} hint={hint} />
);

function formatLoadDisplay(load1: number, cpus: number): { main: string; sub: string } {
  const main = load1 >= 100 ? load1.toFixed(0) : load1.toFixed(2);
  const ref = Math.max(0.1, cpus);
  const sub =
    load1 > ref * 4
      ? `Fila muito acima de ~${ref.toFixed(1)} (saudável p/ ${cpus} CPU(s))`
      : `Saudável: load 1m preferencialmente abaixo de ~${(ref * 2).toFixed(0)} (${cpus} CPU(s))`;
  return { main, sub };
}

function formatFirebaseLatency(ms: number | undefined): string {
  if (ms == null) return '';
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${ms} ms`;
}

export const AdminOpsMonitor: React.FC<{ user: SessionUser | null }> = ({ user }) => {
  const [data, setData] = useState<AdminOpsSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const token = await user.getIdToken();
      const r = await fetch(apiUrl('/api/admin/ops-snapshot'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const j = (await r.json()) as AdminOpsSnapshot & { error?: string; hint?: string };
      if (!r.ok) {
        const msg = [(j as { error?: string }).error, (j as { hint?: string }).hint]
          .filter(Boolean)
          .join(' — ');
        setErr(msg || `HTTP ${r.status}`);
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
    const id = window.setInterval(load, 22_000);
    return () => clearInterval(id);
  }, [user, load]);

  const bars = data ? bucket24hRam(data.history) : [];
  const maxBar = Math.max(1, ...bars);
  const health = data ? healthSummary(data.alerts) : null;

  const healthBadge: 'success' | 'warning' | 'danger' = useMemo(() => {
    if (!data) return 'success';
    if (data.alerts.some((a) => a.level === 'critical')) return 'danger';
    if (data.alerts.length > 0) return 'warning';
    return 'success';
  }, [data]);

  if (!user) return null;

  return (
    <CollapsibleSection
      title="Integrações & host"
      summary={health?.title ?? 'Métricas do processo Node'}
      defaultOpen
      actions={
        <div className="flex items-center gap-2">
          {data?.at && (
            <span className="ui-caption tabular-nums hidden sm:inline">
              {new Date(data.at).toLocaleTimeString('pt-BR')}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={load}
            loading={loading}
            aria-label="Atualizar métricas operacionais"
            leftIcon={<RefreshCw className="w-3.5 h-3.5" aria-hidden />}
          >
            <span className="hidden sm:inline">Atualizar</span>
          </Button>
        </div>
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

        {data && health && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge dot variant={healthBadge}>
              {health.title}
            </Badge>
            {health.detail && <span className="ui-caption">{health.detail}</span>}
            <span className="ui-caption ml-auto">Atualização ~20s</span>
          </div>
        )}

        {data?.scopeNote && (
          <details className="ui-caption">
            <summary className="cursor-pointer" style={{ color: 'var(--text-2)' }}>
              Escopo das métricas
            </summary>
            <p className="mt-1.5 zm-panel">{data.scopeNote}</p>
          </details>
        )}

        {data && data.alerts.length > 0 && (
          <ul role="list" aria-label="Alertas operacionais" className="space-y-2">
            {data.alerts.map((a, idx) => (
              <li
                key={`${a.code}-${idx}`}
                className="zm-panel ui-body flex gap-3 py-3"
                style={{
                  background: a.level === 'critical' ? 'var(--semantic-danger-bg)' : 'var(--semantic-warning-bg)'
                }}
              >
                <AlertTriangle
                  className="w-4 h-4 shrink-0 mt-0.5"
                  style={{ color: a.level === 'critical' ? 'var(--semantic-danger-fg)' : 'var(--warning)' }}
                  aria-hidden
                />
                <span>{a.message}</span>
              </li>
            ))}
          </ul>
        )}

        {data && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="zm-panel space-y-3 lg:col-span-1">
              <span className="ui-overline flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5" aria-hidden />
                Host
              </span>
              <div className="flex flex-wrap justify-center gap-5 sm:gap-6 pt-1">
                <RingGauge
                  percent={data.system.cpu}
                  label="CPU"
                  primary={`${Math.round(data.system.cpu)}%`}
                  secondary="instantâneo"
                  size={84}
                  stroke={5}
                />
                <RingGauge
                  percent={Math.min(100, (data.system.load1 / Math.max(0.001, data.system.cpus)) * 100)}
                  label="Carga 1 min"
                  primary={formatLoadDisplay(data.system.load1, data.system.cpus).main}
                  secondary={`Vs ${data.system.cpus} CPU`}
                  size={84}
                  stroke={5}
                />
              </div>
              <p className="ui-caption">
                5m / 15m: {data.system.load5.toFixed(1)} / {data.system.load15.toFixed(1)} · {data.system.cpus} CPU(s)
              </p>
            </div>
            <div className="zm-panel space-y-3">
              <span className="ui-overline flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5" aria-hidden />
                Processo Node
              </span>
              <div className="flex flex-wrap justify-center gap-5 sm:gap-6 pt-1">
                <RingGauge
                  percent={data.system.ram}
                  label="RAM (processo)"
                  primary={`${Math.round(data.system.ram)}%`}
                  secondary="reservado no host"
                  size={84}
                  stroke={5}
                />
                <RingGauge
                  percent={
                    data.system.processRssMb > 0
                      ? Math.min(100, (data.system.processHeapMb / data.system.processRssMb) * 100)
                      : 0
                  }
                  label="Heap / RSS"
                  primary={`${data.system.processRssMb > 0 ? Math.round((data.system.processHeapMb / data.system.processRssMb) * 100) : 0}%`}
                  secondary={`Heap ${data.system.processHeapMb} MB · RSS ${data.system.processRssMb} MB${
                    data.system.processUptimeSec > 0 ? ` · ${Math.floor(data.system.processUptimeSec / 60)} min` : ''
                  }`}
                  size={84}
                  stroke={5}
                />
              </div>
            </div>
            <div className="zm-panel space-y-3">
              <span className="ui-overline flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5" aria-hidden />
                Integrações
              </span>
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Wifi className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  <span className="ui-overline">Firebase</span>
                  {data.firebase.pingOk ? (
                    <Badge variant={data.firebase.latencyMs != null && data.firebase.latencyMs > 15_000 ? 'warning' : 'success'}>
                      {data.firebase.latencyMs != null
                        ? `OK · ${formatFirebaseLatency(data.firebase.latencyMs)}`
                        : 'OK'}
                    </Badge>
                  ) : (
                    <Badge variant="danger">Falha</Badge>
                  )}
                </div>
                {data.firebase.projectId && (
                  <span className="ui-caption block truncate">{data.firebase.projectId}</span>
                )}
                {data.firebase.error && (
                  <p className="ui-caption" style={{ color: 'var(--semantic-danger-fg)' }}>
                    {data.firebase.error}
                  </p>
                )}
                <Metric
                  label="Sessões WA (API)"
                  value={String(data.whatsapp.connectedSessions)}
                  hint={`Conforto ~${data.whatsapp.capacityHint.safe}`}
                />
                <p className="ui-caption tabular-nums">
                  Router: {data.sessionRouter.commandsCompleted} ok · {data.sessionRouter.commandsFailed} falh. · workers{' '}
                  {data.sessionRouter.aliveWorkers}
                </p>
              </div>
            </div>
          </div>
        )}

        {data && data.history.length > 0 && (
          <div className="zm-panel space-y-3">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <span className="ui-section-title">RAM do processo (24h)</span>
              <span className="ui-caption">Pico por hora</span>
            </div>
            <div className="flex justify-between text-[9px] mb-1 px-0.5 font-medium" style={{ color: 'var(--text-3)' }}>
              <span>−24h</span>
              <span>−12h</span>
              <span className="text-[var(--text-2)]">Agora</span>
            </div>
            <div
              className="flex items-end gap-0.5 h-20 sm:h-[88px] rounded-xl px-1.5 py-1.5"
              style={{ background: 'var(--surface-2)' }}
              role="img"
              aria-label="Gráfico de percentagem de RAM do processo nas últimas 24 horas"
            >
              {bars.map((b, i) => (
                <div
                  key={i}
                  className="flex-1 min-w-0 rounded-t-md transition-all duration-500"
                  style={{
                    height: `${(b / maxBar) * 100}%`,
                    minHeight: b > 0 ? '3px' : '0',
                    background: b >= 90 ? 'var(--ops-hist-high)' : b >= 75 ? 'var(--ops-hist-mid)' : 'var(--ops-hist-low)'
                  }}
                  title={`Hora aprox. ${i + 1}/24: ${b}% máx.`}
                />
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-[9px]" style={{ color: 'var(--text-3)' }}>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--ops-hist-low)' }} /> &lt;75%
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--ops-hist-mid)' }} /> 75–90%
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--ops-hist-high)' }} /> ≥90%
              </span>
            </div>
          </div>
        )}

        {data && data.history.length === 0 && !loading && (
          <p className="ui-caption text-center py-1">
            Histórico a encher: primeiro ponto ~5 min após arranque da API.
          </p>
        )}
      </div>
    </CollapsibleSection>
  );
};
