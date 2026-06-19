import React, { useMemo } from 'react';
import {
  Activity,
  ArrowRight,
  ChevronRight,
  Crown,
  Medal,
  Plus,
  Radio,
  Rocket,
  Smartphone,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { Campaign, CampaignStatus, WhatsAppConnection, ConnectionStatus } from '../../types';
import { getCampaignProgressMetrics } from '../../utils/campaignMetrics';
import { Badge, Button, EmptyState } from '../ui';
import { PulseChart, fmtInt } from './CampaignVisuals';

interface CampaignsOverviewProps {
  campaigns: Campaign[];
  connections: WhatsAppConnection[];
  onOpenDetails: (id: string) => void;
  onViewAll: () => void;
  onCreate: () => void;
}

const HOURS_IN_DAY = 24;

const startOfDayTs = (d: Date) => {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n.getTime();
};

export const CampaignsOverview: React.FC<CampaignsOverviewProps> = ({
  campaigns,
  connections,
  onOpenDetails,
  onViewAll,
  onCreate,
}) => {
  const data = useMemo(() => {
    const now = new Date();
    const now24Ts = now.getTime();
    const today0 = startOfDayTs(now);
    const yesterday0 = today0 - 86_400_000;
    const week7Start = today0 - 7 * 86_400_000;

    const hourBuckets = new Array(HOURS_IN_DAY).fill(0) as number[];
    campaigns.forEach((c) => {
      (c.logs ?? []).forEach((l) => {
        if (l.type !== 'SUCCESS') return;
        const ts = new Date(l.timestamp).getTime();
        const diffMs = now24Ts - ts;
        if (diffMs < 0 || diffMs > 24 * 3600 * 1000) return;
        const hoursAgo = Math.floor(diffMs / (3600 * 1000));
        const idx = HOURS_IN_DAY - 1 - hoursAgo;
        if (idx >= 0 && idx < HOURS_IN_DAY) hourBuckets[idx]++;
      });
    });

    const totalPulse = hourBuckets.reduce((a, v) => a + v, 0);
    if (totalPulse === 0 && campaigns.length > 0) {
      campaigns.forEach((c) => {
        if (!c.createdAt) return;
        const created = new Date(c.createdAt).getTime();
        const diffMs = now24Ts - created;
        if (diffMs < 0 || diffMs > 24 * 3600 * 1000) return;
        const hoursAgo = Math.floor(diffMs / (3600 * 1000));
        const idx = HOURS_IN_DAY - 1 - hoursAgo;
        if (idx >= 0 && idx < HOURS_IN_DAY) hourBuckets[idx] += c.successCount;
      });
    }

    const todaySent = campaigns.reduce((a, c) => {
      if (!c.createdAt) return a;
      const ts = new Date(c.createdAt).getTime();
      if (ts >= today0 && ts < today0 + 86_400_000) return a + c.successCount;
      return a;
    }, 0);
    const yesterdaySent = campaigns.reduce((a, c) => {
      if (!c.createdAt) return a;
      const ts = new Date(c.createdAt).getTime();
      if (ts >= yesterday0 && ts < today0) return a + c.successCount;
      return a;
    }, 0);
    const week7Sent = campaigns.reduce((a, c) => {
      if (!c.createdAt) return a;
      const ts = new Date(c.createdAt).getTime();
      if (ts >= week7Start && ts < today0) return a + c.successCount;
      return a;
    }, 0);
    const avg7d = Math.round(week7Sent / 7);

    const deltaVsYesterday =
      yesterdaySent === 0 ? (todaySent > 0 ? 100 : 0) : Math.round(((todaySent - yesterdaySent) / yesterdaySent) * 100);

    const eligibles = campaigns.filter((c) => getCampaignProgressMetrics(c).effectiveProcessed >= 30);
    const ranked = [...eligibles]
      .sort((a, b) => {
        const ma = getCampaignProgressMetrics(a);
        const mb = getCampaignProgressMetrics(b);
        const ra = ma.effectiveProcessed > 0 ? a.successCount / ma.effectiveProcessed : 0;
        const rb = mb.effectiveProcessed > 0 ? b.successCount / mb.effectiveProcessed : 0;
        return rb - ra;
      })
      .slice(0, 3);

    const recent = [...campaigns]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6);

    const running = campaigns.filter((c) => c.status === CampaignStatus.RUNNING);
    const scheduled = campaigns.filter((c) => c.status === CampaignStatus.SCHEDULED);
    const paused = campaigns.filter((c) => c.status === CampaignStatus.PAUSED);

    return {
      hourBuckets,
      todaySent,
      yesterdaySent,
      avg7d,
      deltaVsYesterday,
      ranked,
      recent,
      running,
      scheduled,
      paused,
    };
  }, [campaigns]);

  const onlineChips = connections.filter((c) => c.status === ConnectionStatus.CONNECTED).length;

  if (campaigns.length === 0) {
    return (
      <EmptyState
        icon={<Rocket className="w-6 h-6" style={{ color: 'var(--brand-600)' }} />}
        title="Nenhuma campanha ainda"
        description="Crie sua primeira campanha e dispare mensagens para toda sua base de contatos com segurança."
        action={
          <Button variant="primary" leftIcon={<Plus className="w-4 h-4" />} onClick={onCreate}>
            Criar Campanha
          </Button>
        }
      />
    );
  }

  const radarPct = campaigns.length > 0 ? Math.min(100, Math.round((data.running.length / Math.max(1, campaigns.length)) * 100 + data.todaySent / 50)) : 0;

  return (
    <div className="space-y-4">
      {/* Hero radar */}
      <div
        className="rounded-[24px] overflow-hidden relative p-5 sm:p-6"
        style={{
          background: 'linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(6,182,212,0.08) 50%, transparent 100%)',
          border: '1px solid rgba(99,102,241,0.25)',
        }}
      >
        <div className="flex flex-col lg:flex-row gap-6 items-center">
          <div className="relative w-[180px] h-[180px] shrink-0">
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
              <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(99,102,241,0.15)" strokeWidth="8" />
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke="url(#radarGrad)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${(radarPct / 100) * 327} 327`}
              />
              <defs>
                <linearGradient id="radarGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#06B6D4" />
                  <stop offset="100%" stopColor="#22d3ee" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <Sparkles className="w-5 h-5 text-cyan-400 mb-1" />
              <span className="text-[28px] font-black tabular-nums" style={{ color: 'var(--text-1)' }}>
                {data.running.length}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                ao vivo
              </span>
            </div>
          </div>

          <div className="flex-1 min-w-0 w-full">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-cyan-400 mb-1">Command radar</p>
            <h2 className="text-[20px] sm:text-[22px] font-black mb-3" style={{ color: 'var(--text-1)' }}>
              Pulso das suas operações
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: 'Hoje', val: data.todaySent, delta: data.deltaVsYesterday, icon: <Zap className="w-3.5 h-3.5" /> },
                { label: 'Média 7d', val: data.avg7d, icon: <Activity className="w-3.5 h-3.5" /> },
                { label: 'Agendadas', val: data.scheduled.length, icon: <Radio className="w-3.5 h-3.5" /> },
                { label: 'Chips', val: onlineChips, icon: <Smartphone className="w-3.5 h-3.5" /> },
              ].map((k) => (
                <div
                  key={k.label}
                  className="rounded-xl px-3 py-2.5"
                  style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-1.5 mb-1" style={{ color: '#818cf8' }}>
                    {k.icon}
                    <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                      {k.label}
                    </span>
                  </div>
                  <div className="flex items-end justify-between gap-1">
                    <span className="text-[18px] font-black tabular-nums" style={{ color: 'var(--text-1)' }}>
                      {fmtInt(k.val)}
                    </span>
                    {'delta' in k && k.delta !== undefined && (
                      <span
                        className="text-[10px] font-bold flex items-center gap-0.5"
                        style={{ color: k.delta >= 0 ? '#22c55e' : '#ef4444' }}
                      >
                        {k.delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {k.delta >= 0 ? '+' : ''}
                        {k.delta}%
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        {/* Pulso 24h */}
        <div
          className="col-span-12 lg:col-span-8 rounded-2xl p-4 sm:p-5"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div>
              <h3 className="text-[14px] font-black" style={{ color: 'var(--text-1)' }}>
                Ritmo 24h
              </h3>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                Envios bem-sucedidos por hora
              </p>
            </div>
            <Badge variant="neutral">{fmtInt(data.hourBuckets.reduce((a, v) => a + v, 0))} total</Badge>
          </div>
          <PulseChart values={data.hourBuckets} height={130} color="#06B6D4" labels={['-24h', '-18h', '-12h', '-6h', 'agora']} />
        </div>

        {/* Pódio */}
        <div
          className="col-span-12 lg:col-span-4 rounded-2xl p-4 sm:p-5"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Crown className="w-4 h-4 text-amber-500" />
            <h3 className="text-[14px] font-black" style={{ color: 'var(--text-1)' }}>
              Top performance
            </h3>
          </div>
          {data.ranked.length === 0 ? (
            <p className="text-[12px] py-6 text-center" style={{ color: 'var(--text-3)' }}>
              Mínimo 30 envios processados para ranking.
            </p>
          ) : (
            <div className="space-y-2">
              {data.ranked.map((camp, i) => (
                <PodiumRow
                  key={camp.id}
                  rank={i + 1}
                  name={camp.name}
                  rate={getCampaignProgressMetrics(camp).successRatePct}
                  onClick={() => onOpenDetails(camp.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Timeline recentes */}
      <div
        className="rounded-2xl p-4 sm:p-5"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <div>
            <h3 className="text-[14px] font-black" style={{ color: 'var(--text-1)' }}>
              Linha do tempo
            </h3>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              Campanhas recentes — clique para abrir
            </p>
          </div>
          <button
            type="button"
            onClick={onViewAll}
            className="text-[11px] font-bold flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--surface-0)]"
            style={{ color: '#818cf8' }}
          >
            Ver todas <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {data.recent.map((camp) => {
            const m = getCampaignProgressMetrics(camp);
            const isRunning = camp.status === CampaignStatus.RUNNING;
            return (
              <button
                key={camp.id}
                type="button"
                onClick={() => onOpenDetails(camp.id)}
                className="text-left rounded-xl p-3 transition-all hover:-translate-y-0.5"
                style={{
                  background: 'var(--surface-0)',
                  border: `1px solid ${isRunning ? 'rgba(99,102,241,0.35)' : 'var(--border-subtle)'}`,
                }}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-[13px] font-bold truncate flex-1" style={{ color: 'var(--text-1)' }}>
                    {camp.name}
                  </p>
                  <Badge variant={isRunning ? 'success' : 'neutral'} dot={isRunning}>
                    {isRunning ? 'Live' : camp.status === CampaignStatus.SCHEDULED ? 'Agendada' : 'Histórico'}
                  </Badge>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden mb-2" style={{ background: 'var(--surface-2)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${m.progressPct}%`,
                      background: isRunning ? 'linear-gradient(90deg,#06B6D4,#22d3ee)' : '#94a3b8',
                    }}
                  />
                </div>
                <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-3)' }}>
                  <Users className="w-3 h-3" />
                  {fmtInt(camp.totalContacts)} contatos
                  <span>·</span>
                  <span className="font-bold tabular-nums" style={{ color: '#818cf8' }}>
                    {m.progressPct}%
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {(data.running.length > 0 || data.paused.length > 0) && (
        <div
          className="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
          style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}
        >
          <div className="flex items-center gap-2 flex-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <span className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
              {data.running.length} em execução · {data.paused.length} pausada(s)
            </span>
          </div>
          <Button variant="secondary" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />} onClick={onViewAll}>
            Abrir operações
          </Button>
        </div>
      )}
    </div>
  );
};

const PodiumRow: React.FC<{ rank: number; name: string; rate: number; onClick: () => void }> = ({
  rank,
  name,
  rate,
  onClick,
}) => {
  const medal =
    rank === 1
      ? { icon: <Crown className="w-3.5 h-3.5" />, tone: '#f59e0b' }
      : { icon: <Medal className="w-3.5 h-3.5" />, tone: rank === 2 ? '#94a3b8' : '#cd7f32' };
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl p-2.5 flex items-center gap-2.5 text-left hover:opacity-90"
      style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
    >
      <span
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-white"
        style={{ background: medal.tone }}
      >
        {medal.icon}
      </span>
      <span className="text-[12px] font-bold truncate flex-1" style={{ color: 'var(--text-1)' }}>
        {name}
      </span>
      <span className="text-[13px] font-black tabular-nums" style={{ color: medal.tone }}>
        {rate}%
      </span>
    </button>
  );
};
