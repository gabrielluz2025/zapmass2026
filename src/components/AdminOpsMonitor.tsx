import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { Activity, AlertTriangle, Cpu, HardDrive, Radio, RefreshCw, Server, Shield, Wifi } from 'lucide-react';
import { Card, CardHeader, Badge, Button, RingGauge } from './ui';

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
  <div className="flex flex-col gap-0.5 min-w-0 rounded-lg px-2 py-1.5 -mx-0.5" style={{ background: 'var(--surface-2)' }}>
    <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
      {label}
    </span>
    <span className="text-[15px] font-semibold tabular-nums leading-tight tracking-tight truncate" style={{ color: 'var(--text-1)' }}>
      {value}
    </span>
    {hint && (
      <span className="text-[10px] leading-snug" style={{ color: 'var(--text-3)' }}>
        {hint}
      </span>
    )}
  </div>
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

export const AdminOpsMonitor: React.FC<{ user: User | null }> = ({ user }) => {
  const [data, setData] = useState<AdminOpsSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const token = await user.getIdToken();
      const r = await fetch('/api/admin/ops-snapshot', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const j = (await r.json()) as AdminOpsSnapshot & { error?: string };
      if (!r.ok) {
        setErr((j as { error?: string }).error || `HTTP ${r.status}`);
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
              style={{ background: 'var(--semantic-info-tint)' }}
            >
              <Server className="w-[18px] h-[18px] text-indigo-500" aria-hidden />
            </div>
          }
          title="Operações & integrações"
          subtitle="Métricas técnicas do processo e do host — leitura em blocos, atualização automática a cada ~20s."
          actions={
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <Badge variant="info" className="text-[10px]">
                <Shield className="w-3 h-3 mr-1 inline" aria-hidden />
                Admin
              </Badge>
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
                aria-label="Atualizar métricas operacionais"
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

        {data && health && (
          <div
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl px-4 py-3"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border-subtle)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)'
            }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: healthBadge === 'danger' ? 'var(--semantic-danger-bg)' : healthBadge === 'warning' ? 'var(--semantic-warning-bg)' : 'var(--semantic-success-bg)' }}
              >
                <Activity className="w-4 h-4" style={{ color: healthBadge === 'danger' ? 'var(--danger)' : healthBadge === 'warning' ? 'var(--warning)' : 'var(--semantic-success-fg)' }} aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge dot variant={healthBadge}>
                    {health.title}
                  </Badge>
                </div>
                {health.detail && (
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                    {health.detail}
                  </p>
                )}
              </div>
            </div>
            <span className="text-[10px] sm:text-right shrink-0 leading-relaxed" style={{ color: 'var(--text-3)' }}>
              Atual. automática ~20s
              <br />
              <span className="opacity-80">histórico ~24h (amostra)</span>
            </span>
          </div>
        )}

        {data?.scopeNote && (
          <p
            className="text-[11px] leading-relaxed rounded-xl px-3 py-2.5"
            style={{ color: 'var(--text-2)', background: 'var(--surface-2)' }}
          >
            {data.scopeNote}
          </p>
        )}

        {data && data.alerts.length > 0 && (
          <div role="list" aria-label="Alertas operacionais" className="space-y-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              Alertas
            </p>
            <ul className="space-y-2">
            {data.alerts.map((a, idx) => (
              <li
                key={`${a.code}-${idx}`}
                className="rounded-2xl pl-0 pr-3 py-3 text-[12px] leading-relaxed flex gap-3"
                style={{
                  border: `1px solid ${a.level === 'critical' ? 'rgba(220, 38, 38, 0.25)' : 'rgba(234, 179, 8, 0.25)'}`,
                  background: a.level === 'critical' ? 'var(--semantic-danger-bg)' : 'var(--semantic-warning-bg)',
                  color: 'var(--text-2)'
                }}
              >
                {a.level === 'critical' ? (
                  <AlertTriangle className="w-4 h-4 shrink-0 ml-3 mt-0.5" style={{ color: 'var(--semantic-danger-fg)' }} aria-hidden />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 ml-3 mt-0.5 opacity-70" style={{ color: 'var(--warning)' }} aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <span
                    className="text-[10px] font-bold uppercase tracking-wide"
                    style={{ color: a.level === 'critical' ? 'var(--semantic-danger-fg)' : 'var(--semantic-warning-fg)' }}
                  >
                    {a.level === 'critical' ? 'Crítico' : 'Aviso'}
                  </span>
                  <p className="mt-1" style={{ color: 'var(--text-2)' }}>
                {a.message}
                  </p>
                </div>
              </li>
            ))}
            </ul>
          </div>
        )}

        {data && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div
              className="rounded-2xl p-4 space-y-3"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
                  <Cpu className="w-4 h-4 text-indigo-400 shrink-0" aria-hidden />
                  Host
                </div>
              </div>
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
              <p className="text-[10px] leading-snug pt-0.5" style={{ color: 'var(--text-3)' }}>
                5m / 15m: {data.system.load5.toFixed(1)} / {data.system.load15.toFixed(1)} · {data.system.cpus} CPU(s)
              </p>
            </div>
            <div
              className="rounded-2xl p-4 space-y-3"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
                <HardDrive className="w-4 h-4 text-violet-400 shrink-0" aria-hidden />
                Processo Node
              </div>
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
            <div
              className="rounded-2xl p-4 space-y-3"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
                <Radio className="w-4 h-4 text-emerald-500/90 shrink-0" aria-hidden />
                Integrações
              </div>
              <div className="space-y-2.5">
                <div
                  className="rounded-lg px-2 py-2 space-y-1"
                  style={{ background: 'var(--surface-2)' }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Wifi className="w-3.5 h-3.5 text-amber-500/80 shrink-0" aria-hidden />
                    <span className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>
                      Firebase
                    </span>
                    {data.firebase.pingOk ? (
                      <Badge variant={data.firebase.latencyMs != null && data.firebase.latencyMs > 15_000 ? 'warning' : 'success'} className="text-[10px]">
                        {data.firebase.latencyMs != null
                          ? `OK · ${formatFirebaseLatency(data.firebase.latencyMs)}`
                          : 'OK'}
                      </Badge>
                    ) : (
                      <Badge variant="danger" className="text-[10px]">
                        Falha
                      </Badge>
                    )}
                  </div>
                  {data.firebase.projectId && (
                    <span className="text-[10px] block truncate" style={{ color: 'var(--text-3)' }}>
                      {data.firebase.projectId}
                    </span>
                  )}
                {data.firebase.error && (
                  <p className="text-[10px] break-words" style={{ color: 'var(--semantic-danger-fg)' }}>
                    {data.firebase.error}
                  </p>
                )}
                </div>
                <Metric
                  label="Sessões WA (API)"
                  value={String(data.whatsapp.connectedSessions)}
                  hint={`Conforto ~${data.whatsapp.capacityHint.safe} · instável &gt; ~${data.whatsapp.capacityHint.critical}`}
                />
                <p className="text-[10px] tabular-nums leading-snug rounded-lg px-2 py-1.5" style={{ color: 'var(--text-3)', background: 'var(--surface-2)' }}>
                  Router: {data.sessionRouter.commandsCompleted} ok · {data.sessionRouter.commandsFailed} falh. · workers {data.sessionRouter.aliveWorkers}
                </p>
              </div>
            </div>
          </div>
        )}

        {data && data.history.length > 0 && (
          <div
            className="rounded-2xl p-4 space-y-3"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <span className="text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>
                RAM do processo (24h)
              </span>
              <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                Pico por hora · esq. mais antigo → direita recente
              </span>
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
          <p className="text-[11px] text-center py-1" style={{ color: 'var(--text-3)' }}>
            Histórico a encher: primeiro ponto cerca de 5 min após o arranque da API.
          </p>
        )}
      </div>
    </Card>
  );
};
