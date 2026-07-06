import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Loader2, Server } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { fetchOpsHealth, type OpsHealth } from '../../services/tenantExtrasApi';
import { Card } from '../ui';

/** Saúde operacional da conta (fila, Redis) — visível no painel. */
export const TenantOpsHealthCard: React.FC = () => {
  const { user } = useAuth();
  const [data, setData] = useState<OpsHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await user.getIdToken();
        const h = await fetchOpsHealth(token);
        if (!cancelled) setData(h);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) {
    return (
      <Card className="p-4 flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-3)' }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Carregando saúde da operação…
      </Card>
    );
  }

  if (!data?.ok) return null;

  const q = data.queue;
  const redis = data.redisUsedPct;
  const hasIssue = q.dead > 0 || q.failed > 5 || (redis != null && redis > 85) || q.backpressureActive;

  return (
    <Card
      className="p-4"
      style={
        hasIssue
          ? { borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.04)' }
          : undefined
      }
    >
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: hasIssue ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.12)' }}
        >
          {hasIssue ? (
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          ) : (
            <Activity className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
            Saúde da operação
          </p>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <Stat label="Na fila" value={String(q.pending)} />
            <Stat label="Enviando" value={String(q.sending)} />
            <Stat label="Falhas" value={String(q.failed)} warn={q.failed > 0} />
            <Stat label="DLQ (mortas)" value={String(q.dead)} warn={q.dead > 0} />
            <Stat label="Última hora" value={String(q.sent_last_hour)} />
            {redis != null ? (
              <Stat label="Redis" value={`${redis.toFixed(0)}%`} warn={redis > 85} />
            ) : null}
            {q.backpressureActive ? (
              <span className="col-span-2 text-amber-600 font-semibold flex items-center gap-1">
                <Server className="w-3 h-3" /> Backpressure ativo — envios mais lentos
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );
};

const Stat: React.FC<{ label: string; value: string; warn?: boolean }> = ({ label, value, warn }) => (
  <div>
    <span className="block text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
      {label}
    </span>
    <span className="font-bold tabular-nums" style={{ color: warn ? '#f59e0b' : 'var(--text-1)' }}>
      {value}
    </span>
  </div>
);
