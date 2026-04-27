import React, { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { Activity, Bell, Radio, Server } from 'lucide-react';

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

  if (!user) return null;

  const bars = data ? bucket24hRam(data.history) : [];
  const maxBar = Math.max(1, ...bars);

  return (
    <div
      className="mt-4 rounded-2xl p-4 space-y-3"
      style={{
        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.06), rgba(15, 23, 42, 0.04))',
        border: '1px solid var(--border-subtle)'
      }}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(99, 102, 241, 0.12)' }}
          >
            <Server className="w-4 h-4 text-indigo-500" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="text-[13px] font-bold leading-tight" style={{ color: 'var(--text-1)' }}>
              Monitor operacional (admin)
            </h3>
            <p className="text-[10.5px] mt-0.5 leading-snug" style={{ color: 'var(--text-3)' }}>
              Só tua conta de administrador. Atualiza ~20s. Histórico: amostra a cada 5 min (máx. 24h no processo).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-3)' }}>
          {loading && <span className="animate-pulse">A ler…</span>}
          {data?.at && <span className="tabular-nums">{new Date(data.at).toLocaleTimeString('pt-BR')}</span>}
        </div>
      </div>

      {err && (
        <div
          className="rounded-lg px-3 py-2 text-[11.5px]"
          style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--text-2)' }}
        >
          {err}
        </div>
      )}

      {data?.scopeNote && (
        <p className="text-[10px] leading-snug" style={{ color: 'var(--text-3)' }}>
          {data.scopeNote}
        </p>
      )}

      {data && data.alerts.length > 0 && (
        <div className="space-y-1.5" role="region" aria-label="Alertas do sistema">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
            <Bell className="w-3.5 h-3.5" aria-hidden />
            Alertas
          </div>
          {data.alerts.map((a) => (
            <div
              key={a.code + a.message.slice(0, 24)}
              className="rounded-lg px-3 py-2 text-[11.5px] leading-snug"
              style={{
                background: a.level === 'critical' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                border: `1px solid ${a.level === 'critical' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(245, 158, 11, 0.3)'}`,
                color: 'var(--text-2)'
              }}
            >
              <strong className="font-semibold" style={{ color: a.level === 'critical' ? '#dc2626' : '#d97706' }}>
                {a.level === 'critical' ? 'Crítico' : 'Aviso'}
              </strong>
              : {a.message}
            </div>
          ))}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div
            className="rounded-xl p-3 space-y-1.5"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
              <Activity className="w-3.5 h-3.5" />
              Agora
            </div>
            <p className="text-[12px] tabular-nums" style={{ color: 'var(--text-2)' }}>
              CPU host (amostra): <strong style={{ color: 'var(--text-1)' }}>{data.system.cpu}%</strong> · Load 1/5/15:{' '}
              <strong style={{ color: 'var(--text-1)' }}>
                {data.system.load1.toFixed(2)} / {data.system.load5.toFixed(2)} / {data.system.load15.toFixed(2)}
              </strong>{' '}
              ({data.system.cpus} núcleo(s))
            </p>
            <p className="text-[12px] tabular-nums" style={{ color: 'var(--text-2)' }}>
              RAM (vista do processo): <strong style={{ color: 'var(--text-1)' }}>{data.system.ram}%</strong> · Heap{' '}
              {data.system.processHeapMb} MB · RSS {data.system.processRssMb} MB
            </p>
          </div>
          <div
            className="rounded-xl p-3 space-y-1.5"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
              <Radio className="w-3.5 h-3.5" />
              Firebase e sessões
            </div>
            <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
              Firebase:{' '}
              {data.firebase.pingOk ? (
                <strong className="text-emerald-600">OK</strong>
              ) : (
                <strong className="text-red-600">falha</strong>
              )}
              {data.firebase.latencyMs != null && ` (${data.firebase.latencyMs} ms)`}
              {data.firebase.projectId && ` · ${data.firebase.projectId}`}
            </p>
            {data.firebase.error && (
              <p className="text-[11px] break-all" style={{ color: '#b91c1c' }}>
                {data.firebase.error}
              </p>
            )}
            <p className="text-[12px]" style={{ color: 'var(--text-2)' }}>
              WA conectados (nesta API): <strong style={{ color: 'var(--text-1)' }}>{data.whatsapp.connectedSessions}</strong>{' '}
              · ref. conforto ~{data.whatsapp.capacityHint.safe} (acima de ~{data.whatsapp.capacityHint.critical} instável)
            </p>
            <p className="text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}>
              Router: ok {data.sessionRouter.commandsCompleted} / falhas {data.sessionRouter.commandsFailed} · workers vivos{' '}
              {data.sessionRouter.aliveWorkers}
            </p>
          </div>
        </div>
      )}

      {data && data.history.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>
            RAM % — resumo 24h (máx. por hora, à esquerda mais antigo)
          </p>
          <div className="flex items-end gap-0.5 h-16" role="img" aria-label="Gráfico de RAM 24 horas">
            {bars.map((b, i) => (
              <div
                key={i}
                className="flex-1 min-w-0 rounded-t-sm transition-all"
                style={{
                  height: `${(b / maxBar) * 100}%`,
                  minHeight: b > 0 ? '4px' : '0',
                  background: b >= 90 ? 'rgba(239, 68, 68, 0.6)' : b >= 75 ? 'rgba(245, 158, 11, 0.55)' : 'rgba(99, 102, 241, 0.45)'
                }}
                title={`H${i + 1}: ${b}% máx. (aprox.)`}
              />
            ))}
          </div>
        </div>
      )}

      {data && data.history.length === 0 && !loading && (
        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          Histórico ainda a encher (primeiro ponto a cada 5 min após arranque da API).
        </p>
      )}
    </div>
  );
};
