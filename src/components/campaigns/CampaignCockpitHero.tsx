import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Lightbulb,
  Pause,
  Play,
  Plus,
  Radio,
  Rocket,
  Send,
  Smartphone,
  Target,
  TrendingUp,
  Zap
} from 'lucide-react';
import {
  Campaign,
  CampaignStatus,
  WhatsAppConnection,
  ConnectionStatus
} from '../../types';
import { getCampaignProgressMetrics } from '../../utils/campaignMetrics';
import { Button } from '../ui';
import { Sparkline, fmtInt } from './CampaignVisuals';

interface CampaignCockpitHeroProps {
  campaigns: Campaign[];
  connections: WhatsAppConnection[];
  onCreate: () => void;
  onOpenDetails: (id: string) => void;
  onTogglePause: (id: string) => void;
}

const formatEta = (seconds: number): string => {
  if (!isFinite(seconds) || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 1) return `${h}h ${m}m`;
  if (m >= 1) return `${m} min`;
  return `${Math.max(1, Math.round(seconds))}s`;
};

export const CampaignCockpitHero: React.FC<CampaignCockpitHeroProps> = ({
  campaigns,
  connections,
  onCreate,
  onOpenDetails,
  onTogglePause
}) => {
  const stats = useMemo(() => {
    const running = campaigns.filter((c) => c.status === CampaignStatus.RUNNING);
    const paused = campaigns.filter((c) => c.status === CampaignStatus.PAUSED);
    const completed = campaigns.filter((c) => c.status === CampaignStatus.COMPLETED);
    const totalProcessed = campaigns.reduce((a, c) => a + getCampaignProgressMetrics(c).effectiveProcessed, 0);
    const totalSuccess = campaigns.reduce((a, c) => a + c.successCount, 0);
    const totalFailed = campaigns.reduce((a, c) => a + c.failedCount, 0);
    const successRate = totalProcessed > 0 ? Math.round((totalSuccess / totalProcessed) * 100) : 0;

    const runningTotal = running.reduce((a, c) => a + c.totalContacts, 0);
    const runningProcessed = running.reduce((a, c) => a + getCampaignProgressMetrics(c).effectiveProcessed, 0);
    const runningProgress = runningTotal > 0 ? (runningProcessed / runningTotal) * 100 : 0;
    const runningPending = running.reduce((a, c) => a + getCampaignProgressMetrics(c).pending, 0);

    const onlineChips = connections.filter((c) => c.status === ConnectionStatus.CONNECTED).length;
    const liveQueueAll = connections.reduce((acc, c) => acc + Math.max(0, Number(c.queueSize) || 0), 0);
    const runningConnIds = new Set(running.flatMap((c) => c.selectedConnectionIds || []));
    const liveQueueRunning = connections
      .filter((c) => runningConnIds.has(c.id))
      .reduce((acc, c) => acc + Math.max(0, Number(c.queueSize) || 0), 0);
    const activeChips = Math.max(1, onlineChips);
    const avgDelay =
      running.length > 0 && runningTotal > 0
        ? running.reduce((a, c) => a + (c.delaySeconds ?? 30) * c.totalContacts, 0) / runningTotal
        : 30;
    const etaSeconds = (runningPending * avgDelay) / activeChips;

    // Campanha destaque (mais próxima de terminar / maior volume)
    const featured =
      running
        .slice()
        .sort((a, b) => {
          const pa =
            a.totalContacts > 0 ? getCampaignProgressMetrics(a).effectiveProcessed / a.totalContacts : 0;
          const pb =
            b.totalContacts > 0 ? getCampaignProgressMetrics(b).effectiveProcessed / b.totalContacts : 0;
          if (pa !== pb) return pb - pa;
          return b.totalContacts - a.totalContacts;
        })[0] || null;

    return {
      running,
      paused,
      completed,
      totalProcessed,
      totalSuccess,
      totalFailed,
      successRate,
      runningTotal,
      runningProcessed,
      runningProgress,
      runningPending,
      onlineChips,
      liveQueueAll,
      liveQueueRunning,
      etaSeconds,
      featured
    };
  }, [campaigns, connections]);

  const hasRunning = stats.running.length > 0;

  // Sugestão de ação inteligente
  const suggestion = useMemo(() => {
    if (campaigns.length === 0)
      return {
        icon: <Rocket className="w-3.5 h-3.5" />,
        text: 'Crie sua primeira campanha agora',
        tone: '#10b981'
      };
    if (hasRunning && stats.onlineChips === 0)
      return {
        icon: <Radio className="w-3.5 h-3.5" />,
        text: 'Reconecte um chip — disparos parados',
        tone: '#ef4444'
      };
    if (stats.paused.length > 0)
      return {
        icon: <Play className="w-3.5 h-3.5" />,
        text: `${stats.paused.length} campanha${stats.paused.length === 1 ? '' : 's'} em pausa — retome`,
        tone: '#f59e0b'
      };
    if (hasRunning)
      return {
        icon: <Activity className="w-3.5 h-3.5" />,
        text: `${fmtInt(stats.runningPending)} envios restantes · ETA ${formatEta(stats.etaSeconds)}`,
        tone: '#3b82f6'
      };
    if (stats.successRate < 60 && stats.totalProcessed > 50)
      return {
        icon: <TrendingUp className="w-3.5 h-3.5" />,
        text: `Taxa de sucesso em ${stats.successRate}% — revise listas e chips`,
        tone: '#f59e0b'
      };
    return {
      icon: <Lightbulb className="w-3.5 h-3.5" />,
      text: 'Clone sua melhor campanha e dispare de novo',
      tone: '#8b5cf6'
    };
  }, [campaigns.length, hasRunning, stats]);

  // Sparkline ao vivo (simulado a partir de amostragens reais do throughput)
  const [sparkData, setSparkData] = useState<number[]>(() => Array(24).fill(0));
  const lastProcessedRef = useRef(stats.runningProcessed);

  useEffect(() => {
    lastProcessedRef.current = stats.runningProcessed;
  }, [stats.runningProcessed]);

  useEffect(() => {
    const interval = setInterval(() => {
      const delta = Math.max(0, stats.runningProcessed - lastProcessedRef.current);
      lastProcessedRef.current = stats.runningProcessed;
      setSparkData((prev) => {
        const next = [...prev.slice(1), delta];
        return next;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [stats.runningProcessed]);

  return (
    <div
      className="grid gap-3"
      style={{
        gridTemplateColumns: 'repeat(12, minmax(0, 1fr))'
      }}
    >
      {/* ───────────────────────────────── BLOCO AO VIVO (grande) ───────────────────────────────── */}
      <div
        className="col-span-12 lg:col-span-8 rounded-2xl relative overflow-hidden"
        style={{
          background: hasRunning
            ? 'linear-gradient(135deg, rgba(16,185,129,0.14) 0%, rgba(59,130,246,0.08) 100%)'
            : 'linear-gradient(135deg, var(--surface-1) 0%, var(--surface-2) 100%)',
          border: `1px solid ${hasRunning ? 'rgba(16,185,129,0.35)' : 'var(--border-subtle)'}`,
          minHeight: 220
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.22]"
          style={{
            background:
              'radial-gradient(680px 240px at 0% 0%, var(--brand-600), transparent 60%), radial-gradient(500px 200px at 100% 100%, rgba(59,130,246,0.7), transparent 60%)'
          }}
          aria-hidden
        />
        {/* Grid pattern */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.08]"
          aria-hidden
        >
          <defs>
            <pattern id="grid-hero" width="24" height="24" patternUnits="userSpaceOnUse">
              <path d="M24 0 L0 0 0 24" fill="none" stroke="currentColor" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid-hero)" />
        </svg>

        <div className="relative p-5 sm:p-6 h-full flex flex-col">
          {/* Eyebrow + badges */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[9.5px] font-extrabold uppercase tracking-[0.16em]"
              style={{
                background: 'rgba(16,185,129,0.16)',
                color: 'var(--brand-600)',
                border: '1px solid rgba(16,185,129,0.3)'
              }}
            >
              <Radio className="w-3 h-3" />
              Mission Command
            </span>
            {hasRunning && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-extrabold uppercase tracking-[0.15em]"
                style={{
                  background: 'rgba(239,68,68,0.15)',
                  color: '#ef4444',
                  border: '1px solid rgba(239,68,68,0.3)'
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                Ao vivo
              </span>
            )}
            <span
              className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md"
              style={{
                background: 'var(--surface-0)',
                color: 'var(--text-3)',
                border: '1px solid var(--border-subtle)'
              }}
            >
              <Smartphone className="w-3 h-3" />
              {stats.onlineChips}/{connections.length} chip{connections.length === 1 ? '' : 's'}
            </span>
          </div>

          {hasRunning && stats.featured ? (
            <FeaturedRunning
              campaign={stats.featured}
              runningCount={stats.running.length}
              onOpenDetails={onOpenDetails}
              onTogglePause={onTogglePause}
              sparkData={sparkData}
            />
          ) : (
            <EmptyHero onCreate={onCreate} totalCampaigns={campaigns.length} completed={stats.completed.length} />
          )}

          {/* Rodapé: barra de progresso agregada (só se running) */}
          {hasRunning && (
            <div className="mt-auto pt-4">
              <div className="flex items-center justify-between text-[10.5px] font-semibold mb-1.5">
                <span style={{ color: 'var(--text-3)' }} className="uppercase tracking-wider">
                  Progresso agregado · {stats.running.length} campanha{stats.running.length === 1 ? '' : 's'}
                </span>
                <span className="tabular-nums" style={{ color: 'var(--text-1)' }}>
                  {Math.round(stats.runningProgress)}% · ETA {formatEta(stats.etaSeconds)}
                </span>
              </div>
              <div
                className="h-1.5 rounded-full overflow-hidden relative"
                style={{ background: 'var(--surface-2)' }}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${Math.min(100, stats.runningProgress)}%`,
                    background: 'linear-gradient(90deg, var(--brand-500), #34d399, var(--brand-500))',
                    backgroundSize: '200% 100%',
                    animation: 'heroShimmer 3s ease-in-out infinite',
                    boxShadow: '0 0 12px rgba(16,185,129,0.6)'
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <style>{`
          @keyframes heroShimmer { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
        `}</style>
      </div>

      {/* ───────────────────────────────── COLUNA DIREITA (KPIs + CTA) ───────────────────────────────── */}
      <div className="col-span-12 lg:col-span-4 flex flex-col gap-3">
        {/* Ação principal + sugestão */}
        <div
          className="rounded-2xl p-4 relative overflow-hidden"
          style={{
            background: 'linear-gradient(160deg, var(--brand-600) 0%, var(--brand-700) 100%)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.15)',
            boxShadow: '0 18px 42px -18px rgba(16,185,129,0.7)'
          }}
        >
          <div
            className="absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-30 pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.6), transparent 70%)' }}
            aria-hidden
          />
          <div className="relative">
            <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.16em] opacity-90 mb-1">
              <Zap className="w-3 h-3" />
              Lançar operação
            </div>
            <p className="text-[17px] font-extrabold leading-tight">
              Nova campanha em
              <br />
              poucos cliques
            </p>
            <button
              type="button"
              onClick={onCreate}
              className="w-full mt-3 rounded-xl px-3 py-2.5 flex items-center justify-center gap-2 text-[13px] font-extrabold transition-all hover:scale-[1.02]"
              style={{
                background: '#fff',
                color: 'var(--brand-700)',
                boxShadow: '0 6px 14px -4px rgba(0,0,0,0.25)'
              }}
            >
              <Plus className="w-4 h-4" />
              Criar campanha
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Sugestão inteligente */}
        <div
          className="rounded-2xl px-3.5 py-3 flex items-center gap-2.5"
          style={{
            background: 'var(--surface-0)',
            border: `1px solid ${suggestion.tone}44`,
            borderLeft: `3px solid ${suggestion.tone}`
          }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `${suggestion.tone}20`, color: suggestion.tone }}
          >
            {suggestion.icon}
          </div>
          <div className="min-w-0">
            <p className="text-[9.5px] font-extrabold uppercase tracking-[0.14em]" style={{ color: 'var(--text-3)' }}>
              Sugestão
            </p>
            <p className="text-[12.5px] font-semibold leading-tight truncate" style={{ color: 'var(--text-1)' }}>
              {suggestion.text}
            </p>
          </div>
        </div>

        {/* KPI compacto */}
        <div className="grid grid-cols-3 gap-2">
          <MiniKpi
            icon={<Target className="w-3.5 h-3.5" />}
            label="Fila"
            value={fmtInt(stats.liveQueueRunning || stats.liveQueueAll)}
            tone="#f59e0b"
            hint={stats.liveQueueRunning > 0 ? 'running' : 'global'}
          />
          <MiniKpi
            icon={<Send className="w-3.5 h-3.5" />}
            label="Enviadas"
            value={
              stats.totalSuccess >= 1000
                ? `${(stats.totalSuccess / 1000).toFixed(stats.totalSuccess >= 10_000 ? 0 : 1)}k`
                : fmtInt(stats.totalSuccess)
            }
            tone="#8b5cf6"
          />
          <MiniKpi
            icon={<TrendingUp className="w-3.5 h-3.5" />}
            label="Sucesso"
            value={`${stats.successRate}%`}
            tone={
              stats.successRate >= 85 ? '#10b981' : stats.successRate >= 60 ? '#f59e0b' : '#ef4444'
            }
          />
        </div>
      </div>
    </div>
  );
};

// ─── Campanha em destaque (quando running) ───
const FeaturedRunning: React.FC<{
  campaign: Campaign;
  runningCount: number;
  onOpenDetails: (id: string) => void;
  onTogglePause: (id: string) => void;
  sparkData: number[];
}> = ({ campaign, runningCount, onOpenDetails, onTogglePause, sparkData }) => {
  const m = getCampaignProgressMetrics(campaign);
  const progress = m.progressPct;
  const rate = m.successRatePct;

  return (
    <>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em]" style={{ color: 'var(--text-3)' }}>
            Campanha em destaque
          </p>
          <h1
            className="text-[22px] sm:text-[26px] font-black leading-tight mt-0.5 truncate"
            style={{ color: 'var(--text-1)' }}
          >
            {campaign.name}
          </h1>
          <div className="flex items-center gap-3 mt-1 text-[12px] font-semibold flex-wrap" style={{ color: 'var(--text-3)' }}>
            <span className="tabular-nums">
              {fmtInt(m.effectiveProcessed)} de {fmtInt(campaign.totalContacts)}
            </span>
            <span>·</span>
            <span className="tabular-nums">{campaign.selectedConnectionIds.length} chip{campaign.selectedConnectionIds.length === 1 ? '' : 's'}</span>
            <span>·</span>
            <span className="tabular-nums">{rate}% sucesso</span>
            {runningCount > 1 && (
              <>
                <span>·</span>
                <span
                  className="tabular-nums px-1.5 py-0.5 rounded-md text-[10.5px] font-bold"
                  style={{
                    background: 'var(--surface-0)',
                    color: 'var(--brand-600)',
                    border: '1px solid rgba(16,185,129,0.3)'
                  }}
                >
                  +{runningCount - 1} rodando
                </span>
              </>
            )}
          </div>
        </div>

        {/* Ações */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onTogglePause(campaign.id)}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-105"
            style={{
              background: campaign.status === CampaignStatus.RUNNING ? 'rgba(245,158,11,0.18)' : 'rgba(16,185,129,0.18)',
              color: campaign.status === CampaignStatus.RUNNING ? '#d97706' : 'var(--brand-600)',
              border: `1px solid ${campaign.status === CampaignStatus.RUNNING ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'}`
            }}
            title={campaign.status === CampaignStatus.RUNNING ? 'Pausar' : 'Retomar'}
          >
            {campaign.status === CampaignStatus.RUNNING ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onOpenDetails(campaign.id)}
            className="h-10 px-3 rounded-xl flex items-center gap-1.5 transition-all hover:scale-105 text-[12.5px] font-bold"
            style={{
              background: 'var(--surface-0)',
              color: 'var(--text-1)',
              border: '1px solid var(--border)'
            }}
          >
            Abrir
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Visual: grande número de progresso + sparkline */}
      <div className="flex items-end gap-4 mt-5">
        <div>
          <p
            className="text-[54px] sm:text-[64px] font-black leading-none tabular-nums"
            style={{
              background: 'linear-gradient(135deg, var(--brand-500), #34d399, #3b82f6)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              color: 'transparent',
              letterSpacing: '-0.03em'
            }}
          >
            {Math.round(progress)}
            <span className="text-[28px] opacity-60">%</span>
          </p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--brand-600)' }}>
              <Activity className="w-3 h-3" />
              Ritmo ao vivo
            </span>
            <span className="text-[10.5px] tabular-nums font-bold" style={{ color: 'var(--text-3)' }}>
              últimos 72s
            </span>
          </div>
          <div
            className="rounded-xl px-2 pt-2 pb-1"
            style={{
              background: 'var(--surface-0)',
              border: '1px solid rgba(16,185,129,0.2)'
            }}
          >
            <Sparkline values={sparkData} width={420} height={52} stroke="var(--brand-500)" fill="rgba(16,185,129,0.15)" />
          </div>
        </div>
      </div>
    </>
  );
};

// ─── Hero vazio (sem running) ───
const EmptyHero: React.FC<{ onCreate: () => void; totalCampaigns: number; completed: number }> = ({
  onCreate,
  totalCampaigns,
  completed
}) => (
  <>
    <p
      className="text-[10.5px] font-extrabold uppercase tracking-[0.16em]"
      style={{ color: 'var(--text-3)' }}
    >
      Campanhas WhatsApp
    </p>
    <h1
      className="text-[26px] sm:text-[30px] font-black leading-[1.05] mt-1"
      style={{
        background: 'linear-gradient(135deg, var(--text-1) 0%, var(--brand-600) 100%)',
        backgroundClip: 'text',
        WebkitBackgroundClip: 'text',
        color: 'transparent'
      }}
    >
      Lance, meça e escale
      <br />
      disparos com precisão
    </h1>
    <p
      className="text-[13px] mt-2 leading-relaxed max-w-[520px]"
      style={{ color: 'var(--text-3)' }}
    >
      Monte a mensagem, escolha público e chips, acompanhe o pulso em tempo real e compare resultados com laboratório A/B.
    </p>

    <div className="flex flex-wrap gap-2 mt-4">
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12.5px] font-extrabold transition-all hover:scale-[1.03]"
        style={{
          background: 'var(--brand-500)',
          color: '#fff',
          boxShadow: '0 8px 18px -6px rgba(16,185,129,0.55)'
        }}
      >
        <Plus className="w-3.5 h-3.5" />
        Criar primeira campanha
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
      {totalCampaigns > 0 && (
        <div
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-bold"
          style={{
            background: 'var(--surface-0)',
            color: 'var(--text-2)',
            border: '1px solid var(--border-subtle)'
          }}
        >
          <Rocket className="w-3.5 h-3.5" style={{ color: 'var(--brand-600)' }} />
          {totalCampaigns} no histórico · {completed} concluída{completed === 1 ? '' : 's'}
        </div>
      )}
    </div>
  </>
);

// ─── KPI compacto ───
const MiniKpi: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: string;
  hint?: string;
}> = ({ icon, label, value, tone, hint }) => (
  <div
    className="rounded-xl p-2.5 relative overflow-hidden"
    style={{
      background: 'var(--surface-0)',
      border: '1px solid var(--border-subtle)'
    }}
  >
    <div
      className="absolute inset-0 opacity-50 pointer-events-none"
      style={{ background: `radial-gradient(90px 48px at 100% 0%, ${tone}22, transparent 70%)` }}
      aria-hidden
    />
    <div className="relative">
      <div
        className="w-6 h-6 rounded-md flex items-center justify-center mb-1"
        style={{ background: `${tone}1a`, color: tone, border: `1px solid ${tone}33` }}
      >
        {icon}
      </div>
      <p className="text-[9px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>
        {label}
      </p>
      <p
        className="text-[17px] font-extrabold tabular-nums leading-none mt-0.5"
        style={{ color: 'var(--text-1)' }}
      >
        {value}
      </p>
      {hint && (
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] mt-0.5" style={{ color: 'var(--text-3)' }}>
          {hint}
        </p>
      )}
    </div>
  </div>
);
