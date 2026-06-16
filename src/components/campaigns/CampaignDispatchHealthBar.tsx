/**
 * CampaignDispatchHealthBar
 *
 * Barra de saúde do disparo SEMPRE visível no topo da aba de campanhas (cockpit).
 * Resume, num relance, se é seguro disparar agora:
 *  - Redis / fila (motor de envio)
 *  - Chips online vs. total
 *  - Fila acumulada nos canais
 *
 * Faz polling leve do /api/health/redis e reflete o estado dos chips via props.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, Server, Smartphone, Layers, CheckCircle2, AlertTriangle } from 'lucide-react';
import { fetchRedisHealth } from '../../services/campaignsApi';
import { WhatsAppConnection, ConnectionStatus } from '../../types';

type Health = 'checking' | 'ok' | 'error';

interface Props {
  connections: WhatsAppConnection[];
}

const REDIS_POLL_MS = 30_000;

export const CampaignDispatchHealthBar: React.FC<Props> = ({ connections }) => {
  const [redis, setRedis] = useState<Health>('checking');
  const [lastCheck, setLastCheck] = useState<number>(0);

  const checkRedis = useCallback(async () => {
    setRedis('checking');
    try {
      const r = await fetchRedisHealth();
      setRedis(r.ok ? 'ok' : 'error');
    } catch {
      setRedis('error');
    } finally {
      setLastCheck(Date.now());
    }
  }, []);

  useEffect(() => {
    void checkRedis();
    const t = setInterval(() => void checkRedis(), REDIS_POLL_MS);
    return () => clearInterval(t);
  }, [checkRedis]);

  const onlineChips = connections.filter((c) => c.status === ConnectionStatus.CONNECTED).length;
  const totalChips = connections.length;
  const queueTotal = connections.reduce((acc, c) => acc + Math.max(0, Number(c.queueSize) || 0), 0);

  const chipsOk = onlineChips > 0;
  const readyToDispatch = redis === 'ok' && chipsOk;
  const blocked = redis === 'error' || (!chipsOk && redis !== 'checking');

  const accent = blocked ? '#ef4444' : redis === 'checking' ? '#64748b' : '#10b981';

  return (
    <div
      className="rounded-2xl px-4 py-3 flex items-center gap-3 flex-wrap"
      style={{
        background: blocked
          ? 'linear-gradient(135deg, rgba(239,68,68,0.08), var(--surface-0))'
          : readyToDispatch
          ? 'linear-gradient(135deg, rgba(16,185,129,0.08), var(--surface-0))'
          : 'var(--surface-0)',
        border: `1px solid ${accent}40`,
        borderLeft: `3px solid ${accent}`
      }}
    >
      <div className="flex items-center gap-2 shrink-0">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: `${accent}1a`, color: accent }}
        >
          {readyToDispatch ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : blocked ? (
            <AlertTriangle className="w-4 h-4" />
          ) : (
            <Activity className="w-4 h-4" />
          )}
        </div>
        <div>
          <p className="text-[9.5px] font-extrabold uppercase tracking-[0.14em]" style={{ color: 'var(--text-3)' }}>
            Saúde do disparo
          </p>
          <p className="text-[12.5px] font-bold leading-tight" style={{ color: 'var(--text-1)' }}>
            {readyToDispatch
              ? 'Pronto para disparar'
              : blocked
              ? redis === 'error'
                ? 'Fila (Redis) indisponível'
                : 'Nenhum chip online'
              : 'Verificando…'}
          </p>
        </div>
      </div>

      <div className="hidden sm:block w-px h-8 mx-1" style={{ background: 'var(--border-subtle)' }} />

      <div className="flex items-center gap-2 flex-wrap flex-1">
        <HealthPill
          icon={<Server className="w-3.5 h-3.5" />}
          label="Fila / Redis"
          value={redis === 'ok' ? 'OK' : redis === 'error' ? 'Fora' : '...'}
          tone={redis === 'ok' ? '#10b981' : redis === 'error' ? '#ef4444' : '#64748b'}
        />
        <HealthPill
          icon={<Smartphone className="w-3.5 h-3.5" />}
          label="Chips online"
          value={`${onlineChips}/${totalChips}`}
          tone={chipsOk ? '#10b981' : '#ef4444'}
        />
        <HealthPill
          icon={<Layers className="w-3.5 h-3.5" />}
          label="Na fila"
          value={String(queueTotal)}
          tone={queueTotal > 0 ? '#f59e0b' : 'var(--text-3)'}
        />
      </div>

      <button
        type="button"
        onClick={checkRedis}
        className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
        style={{ background: 'var(--surface-1)', color: 'var(--text-3)', border: '1px solid var(--border-subtle)' }}
        title={lastCheck ? `Última verificação: ${new Date(lastCheck).toLocaleTimeString()}` : 'Verificar agora'}
      >
        <RefreshCw className={`w-3.5 h-3.5 ${redis === 'checking' ? 'animate-spin' : ''}`} />
        Reverificar
      </button>
    </div>
  );
};

const HealthPill: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: string;
}> = ({ icon, label, value, tone }) => (
  <div
    className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
  >
    <span className="flex items-center justify-center" style={{ color: tone }}>
      {icon}
    </span>
    <span className="text-[10.5px] font-semibold" style={{ color: 'var(--text-3)' }}>
      {label}
    </span>
    <span className="text-[12px] font-extrabold tabular-nums" style={{ color: tone }}>
      {value}
    </span>
  </div>
);
