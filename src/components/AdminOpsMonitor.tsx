import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { Activity, Radio, RefreshCw, Server, Shield } from 'lucide-react';
import { Card, CardHeader, Badge, Button } from './ui';

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
  <div className="flex flex-col gap-0.5 min-w-0">
    <span className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>
      {label}
    </span>
    <span className="text-sm font-semibold tabular-nums leading-tight truncate" style={{ color: 'var(--text-1)' }}>
      {value}
    </span>
    {hint && (
      <span className="text-[10px] leading-tight" style={{ color: 'var(--text-3)' }}>
        {hint}
      </span>
    )}
  </div>
);

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
      className="mt-5 overflow-hidden animate-fade-in-up"
      style={{
        background: 'linear-gradient(180deg, var(--ops-panel-fade) 0%, var(--surface-0) 48%)',
        borderColor: 'var(--border-subtle)'
      }}
    >
      <div className="p-1">
        <CardHeader
          icon={
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--semantic-info-tint)' }}
            >
              <Server className="w-[18px] h-[18px] text-indigo-500" aria-hidden />
            </div>
          }
          title="Operações & integrações"
          subtitle="Métricas técnicas do processo e do host — só contas de administrador veem este bloco."
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

      <div className="px-4 pb-4 pt-0 space-y-4">
        {err && (
          <div
            className="rounded-xl px-3 py-2.5 text-[12px] border"
            style={{
              background: 'var(--semantic-danger-bg)',
              borderColor: 'var(--semantic-danger-border)',
              color: 'var(--text-2)'
            }}
            role="alert"
          >
            {err}
          </div>
        )}

        {data && health && (
          <div
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl px-3 py-2.5"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Badge dot variant={healthBadge}>
                {health.title}
              </Badge>
              {health.detail && (
                <span className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
                  {health.detail}
                </span>
              )}
            </div>
            <span className="text-[10px] sm:text-right shrink-0" style={{ color: 'var(--text-3)' }}>
              Amostragem ~20s · histórico ~5 min/pto (24h)
            </span>
          </div>
        )}

        {data?.scopeNote && (
          <p className="text-[11px] leading-relaxed pl-1 border-l-2" style={{ color: 'var(--text-3)', borderColor: 'var(--border)' }}>
            {data.scopeNote}
          </p>
        )}

        {data && data.alerts.length > 0 && (
          <ul className="space-y-2" role="list" aria-label="Alertas operacionais">
            {data.alerts.map((a, idx) => (
              <li
                key={`${a.code}-${idx}`}
                className="rounded-r-lg pl-3 py-2 text-[12px] leading-snug"
                style={{
                  borderLeftWidth: 3,
                  borderLeftStyle: 'solid',
                  borderLeftColor: a.level === 'critical' ? 'var(--danger)' : 'var(--warning)',
                  background: a.level === 'critical' ? 'var(--semantic-danger-bg)' : 'var(--semantic-warning-bg)',
                  color: 'var(--text-2)'
                }}
              >
                <span
                  className="font-medium"
                  style={{ color: a.level === 'critical' ? 'var(--semantic-danger-fg)' : 'var(--semantic-warning-fg)' }}
                >
                  {a.level === 'critical' ? 'Crítico' : 'Aviso'}
                </span>
                <span className="mx-1.5" style={{ color: 'var(--text-3)' }}>
                  ·
                </span>
                {a.message}
              </li>
            ))}
          </ul>
        )}

        {data && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div
              className="rounded-xl p-3.5 space-y-3"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
                <Activity className="w-4 h-4 text-indigo-500 shrink-0" aria-hidden />
                Host
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Metric label="CPU (instantâneo)" value={`${data.system.cpu}%`} />
                <Metric
                  label="Load 1m"
                  value={data.system.load1.toFixed(2)}
                  hint={`${data.system.cpus} CPU(s) · 5m/15m: ${data.system.load5.toFixed(1)} / ${data.system.load15.toFixed(1)}`}
                />
              </div>
            </div>
            <div
              className="rounded-xl p-3.5 space-y-3"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
                <Server className="w-4 h-4 text-violet-500 shrink-0" aria-hidden />
                Processo Node
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Metric label="RAM (vista processo)" value={`${data.system.ram}%`} />
                <Metric
                  label="Heap / RSS"
                  value={`${data.system.processHeapMb} / ${data.system.processRssMb} MB`}
                  hint={data.system.processUptimeSec > 0 ? `Uptime processo: ${Math.floor(data.system.processUptimeSec / 60)} min` : undefined}
                />
              </div>
            </div>
            <div
              className="rounded-xl p-3.5 space-y-3"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
                <Radio className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden />
                Integrações
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>
                    Firebase
                  </span>
                  {data.firebase.pingOk ? (
                    <Badge variant="success" className="text-[10px]">
                      OK{data.firebase.latencyMs != null ? ` ${data.firebase.latencyMs} ms` : ''}
                    </Badge>
                  ) : (
                    <Badge variant="danger" className="text-[10px]">
                      Falha
                    </Badge>
                  )}
                  {data.firebase.projectId && (
                    <span className="text-[10px] truncate max-w-full" style={{ color: 'var(--text-3)' }}>
                      {data.firebase.projectId}
                    </span>
                  )}
                </div>
                {data.firebase.error && (
                  <p className="text-[10px] break-all" style={{ color: 'var(--semantic-danger-fg)' }}>
                    {data.firebase.error}
                  </p>
                )}
                <Metric
                  label="Sessões WA (esta API)"
                  value={String(data.whatsapp.connectedSessions)}
                  hint={`Conforto ~${data.whatsapp.capacityHint.safe} · instável &gt; ~${data.whatsapp.capacityHint.critical}`}
                />
                <p className="text-[10px] tabular-nums leading-snug pt-1" style={{ color: 'var(--text-3)' }}>
                  Router: {data.sessionRouter.commandsCompleted} ok · {data.sessionRouter.commandsFailed} falhas · workers {data.sessionRouter.aliveWorkers}
                </p>
              </div>
            </div>
          </div>
        )}

        {data && data.history.length > 0 && (
          <div>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <span className="text-[11px] font-medium" style={{ color: 'var(--text-2)' }}>
                Uso de RAM (processo) — resumo 24h
              </span>
              <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                Máx. por hora (esq. → antigo)
              </span>
            </div>
            <div className="flex justify-between text-[9px] mb-1 px-0.5" style={{ color: 'var(--text-3)' }}>
              <span>−24h</span>
              <span>−18h</span>
              <span>−12h</span>
              <span>−6h</span>
              <span>Agora</span>
            </div>
            <div
              className="flex items-end gap-px h-[72px] rounded-lg px-1 pt-1"
              style={{ background: 'var(--surface-2)' }}
              role="img"
              aria-label="Gráfico de percentagem de RAM do processo nas últimas 24 horas"
            >
              {bars.map((b, i) => (
                <div
                  key={i}
                  className="flex-1 min-w-0 rounded-t-[2px] transition-all"
                  style={{
                    height: `${(b / maxBar) * 100}%`,
                    minHeight: b > 0 ? '3px' : '0',
                    background: b >= 90 ? 'var(--ops-hist-high)' : b >= 75 ? 'var(--ops-hist-mid)' : 'var(--ops-hist-low)'
                  }}
                  title={`Hora aprox. ${i + 1}/24: ${b}% máx.`}
                />
              ))}
            </div>
            <div className="flex justify-end gap-3 mt-2 text-[9px]" style={{ color: 'var(--text-3)' }}>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--ops-hist-low)' }} /> &lt;75%
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--ops-hist-mid)' }} /> 75–90%
              </span>
              <span className="inline-flex items-center gap-1">
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
