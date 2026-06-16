/**
 * Centro de Comando — cockpit unificado da aba Campanhas.
 *
 * Substitui o antigo "Launch Pad" + barra de saúde separada:
 * - KPIs ao vivo (running, agendadas, pausadas, chips)
 * - Saúde do disparo (Redis + chips + fila) sempre visível
 * - Missões em voo com progresso
 * - Alerta bloqueador com comando VPS copiável quando Redis cai
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Rocket,
  Server,
  Smartphone,
} from 'lucide-react';
import { Campaign, CampaignStatus, ConnectionStatus, WhatsAppConnection } from '../../types';
import { getCampaignProgressMetrics } from '../../utils/campaignMetrics';
import { DispatchFixPanel } from './DispatchFixPanel';
import { fetchDispatchHealth, type DispatchHealth } from '../../services/campaignsApi';

type HealthUi = 'checking' | 'ok' | 'error';

interface Props {
  campaigns: Campaign[];
  connections: WhatsAppConnection[];
  onCreate: () => void;
  onOpenDetails: (id: string) => void;
  onTogglePause: (id: string) => void;
  onGoCampaigns?: () => void;
}

export const CampaignCommandCenter: React.FC<Props> = ({
  campaigns,
  connections,
  onCreate,
  onOpenDetails,
  onTogglePause,
  onGoCampaigns,
}) => {
  const [redisUi, setRedisUi] = useState<HealthUi>('checking');
  const [health, setHealth] = useState<DispatchHealth | null>(null);
  const [lastCheck, setLastCheck] = useState(0);

  const stats = useMemo(() => {
    const running = campaigns.filter((c) => c.status === CampaignStatus.RUNNING);
    const scheduled = campaigns.filter((c) => c.status === CampaignStatus.SCHEDULED);
    const paused = campaigns.filter((c) => c.status === CampaignStatus.PAUSED);
    const onlineChips = connections.filter((c) => c.status === ConnectionStatus.CONNECTED);
    const queueTotal = connections.reduce((acc, c) => acc + Math.max(0, Number(c.queueSize) || 0), 0);
    return { running, scheduled, paused, onlineChips, queueTotal, total: campaigns.length };
  }, [campaigns, connections]);

  const checkHealth = useCallback(async () => {
    setRedisUi('checking');
    try {
      const h = await fetchDispatchHealth();
      setHealth(h);
      setRedisUi(h.redis.ok ? 'ok' : 'error');
    } catch {
      setRedisUi('error');
      setHealth(null);
    } finally {
      setLastCheck(Date.now());
    }
  }, []);

  useEffect(() => {
    void checkHealth();
    const t = setInterval(() => void checkHealth(), 25_000);
    return () => clearInterval(t);
  }, [checkHealth]);

  const readyToDispatch = redisUi === 'ok' && stats.onlineChips.length > 0;
  const accent = redisUi === 'error' ? '#ef4444' : readyToDispatch ? '#10b981' : '#64748b';

  return (
    <div
      className="rounded-[22px] overflow-hidden"
      style={{
        background: 'linear-gradient(145deg, #0a0b14 0%, #12131f 50%, #0d0e16 100%)',
        border: `1px solid ${accent}44`,
        boxShadow: `0 24px 64px -24px ${accent}55`,
      }}
    >
      {/* Faixa superior de status */}
      <div
        className="h-[3px]"
        style={{
          background:
            redisUi === 'error'
              ? 'linear-gradient(90deg, #ef4444, #f97316, #ef4444)'
              : readyToDispatch
              ? 'linear-gradient(90deg, #10b981, #34d399, #3b82f6)'
              : 'linear-gradient(90deg, #64748b, #94a3b8)',
        }}
      />

      <div className="px-5 py-5 sm:px-7 sm:py-6 space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg, #10b981, #059669)',
                boxShadow: '0 8px 24px -6px rgba(16,185,129,0.55)',
              }}
            >
              <Rocket className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-[18px] sm:text-[20px] font-black text-white leading-tight">
                  Centro de Disparos
                </h1>
                {stats.running.length > 0 && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider"
                    style={{ background: 'rgba(239,68,68,0.2)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.35)' }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    Ao vivo
                  </span>
                )}
              </div>
              <p className="text-[11.5px] mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {stats.total} campanha{stats.total !== 1 ? 's' : ''} · cockpit de operação
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-white shrink-0 transition-all hover:-translate-y-0.5"
            style={{
              background: 'linear-gradient(135deg, #10b981, #059669)',
              boxShadow: '0 8px 20px -6px rgba(16,185,129,0.65)',
            }}
          >
            <Plus className="w-4 h-4" />
            Nova campanha
          </button>
        </div>

        {/* Saúde do disparo */}
        <div
          className="rounded-xl px-3.5 py-3 flex flex-col sm:flex-row sm:items-center gap-3"
          style={{
            background: redisUi === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${accent}35`,
          }}
        >
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            {redisUi === 'checking' ? (
              <RefreshCw className="w-4 h-4 shrink-0 animate-spin text-slate-400" />
            ) : redisUi === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
            )}
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.14em]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Saúde do disparo
              </p>
              <p className="text-[13px] font-bold text-white">
                {redisUi === 'checking'
                  ? 'Verificando fila e canais…'
                  : redisUi === 'error'
                  ? 'Bloqueado — Redis offline'
                  : stats.onlineChips.length === 0
                  ? 'Redis OK — conecte um chip'
                  : 'Pronto para disparar'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <HealthChip
              icon={<Server className="w-3.5 h-3.5" />}
              label="Redis"
              value={redisUi === 'ok' ? 'OK' : redisUi === 'error' ? 'Fora' : '…'}
              tone={redisUi === 'ok' ? '#10b981' : redisUi === 'error' ? '#ef4444' : '#64748b'}
              sub={health?.redis.pingMs != null ? `${health.redis.pingMs}ms` : undefined}
            />
            <HealthChip
              icon={<Smartphone className="w-3.5 h-3.5" />}
              label="Chips"
              value={`${stats.onlineChips.length}/${connections.length}`}
              tone={stats.onlineChips.length > 0 ? '#10b981' : '#ef4444'}
            />
            <HealthChip
              icon={<Layers className="w-3.5 h-3.5" />}
              label="Fila"
              value={String(stats.queueTotal)}
              tone={stats.queueTotal > 0 ? '#f59e0b' : 'rgba(255,255,255,0.5)'}
            />
            <button
              type="button"
              onClick={checkHealth}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)' }}
              title={lastCheck ? `Última: ${new Date(lastCheck).toLocaleTimeString()}` : undefined}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${redisUi === 'checking' ? 'animate-spin' : ''}`} />
              Reverificar
            </button>
          </div>
        </div>

        {/* Alerta Redis — bloqueador */}
        {redisUi === 'error' && (
          <DispatchFixPanel compact />
        )}

        {/* KPI tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Em execução', val: stats.running.length, color: '#10b981', icon: <Activity className="w-4 h-4" /> },
            { label: 'Agendadas', val: stats.scheduled.length, color: '#3b82f6', icon: <Radio className="w-4 h-4" /> },
            { label: 'Pausadas', val: stats.paused.length, color: '#f59e0b', icon: <Pause className="w-4 h-4" /> },
            { label: 'Canais online', val: stats.onlineChips.length, color: '#8b5cf6', icon: <Smartphone className="w-4 h-4" /> },
          ].map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={t.label !== 'Canais online' ? onGoCampaigns : undefined}
              className="flex flex-col gap-1 rounded-xl px-3 py-3 text-left transition-all hover:scale-[1.02] disabled:cursor-default"
              style={{ background: `${t.color}12`, border: `1px solid ${t.color}30` }}
              disabled={!onGoCampaigns || t.label === 'Canais online'}
            >
              <span style={{ color: t.color }}>{t.icon}</span>
              <span className="text-[22px] font-black tabular-nums leading-none text-white">{t.val}</span>
              <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.35)' }}>
                {t.label}
              </span>
            </button>
          ))}
        </div>

        {/* Missões em voo */}
        {stats.running.length > 0 && (
          <div className="space-y-2">
            <p className="text-[9.5px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Missões em voo
            </p>
            {stats.running.slice(0, 3).map((c) => {
              const m = getCampaignProgressMetrics(c);
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                  style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.22)' }}
                >
                  <button
                    type="button"
                    onClick={() => onOpenDetails(c.id)}
                    className="flex-1 flex items-center gap-3 min-w-0 text-left"
                  >
                    <span className="text-[15px] shrink-0">📡</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-bold truncate text-white">{c.name}</p>
                      <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${m.progressPct}%`,
                            background: 'linear-gradient(90deg, #10b981, #34d399)',
                          }}
                        />
                      </div>
                    </div>
                    <span className="text-[12px] font-bold tabular-nums shrink-0 text-emerald-400">{m.progressPct}%</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onTogglePause(c.id)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}
                    title="Pausar"
                  >
                    <Pause className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenDetails(c.id)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(255,255,255,0.08)', color: '#fff' }}
                    title="Abrir"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const HealthChip: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: string;
  sub?: string;
}> = ({ icon, label, value, tone, sub }) => (
  <div
    className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
    style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)' }}
  >
    <span style={{ color: tone }}>{icon}</span>
    <span className="text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>
      {label}
    </span>
    <span className="text-[12px] font-extrabold tabular-nums" style={{ color: tone }}>
      {value}
    </span>
    {sub && (
      <span className="text-[9px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
        {sub}
      </span>
    )}
  </div>
);
