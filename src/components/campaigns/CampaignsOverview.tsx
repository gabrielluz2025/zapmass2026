import React, { useMemo } from 'react';
import {
  Activity,
  ArrowRight,
  Award,
  ChevronRight,
  Clock,
  Crown,
  Medal,
  Plus,
  Rocket,
  Smartphone,
  TrendingDown,
  TrendingUp,
  Users
} from 'lucide-react';
import { Campaign, CampaignStatus, WhatsAppConnection, ConnectionStatus } from '../../types';
import { getCampaignProgressMetrics } from '../../utils/campaignMetrics';
import { Badge, Button, Card, EmptyState } from '../ui';
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
  onCreate
}) => {
  const data = useMemo(() => {
    const now = new Date();
    const now24Ts = now.getTime();
    const today0 = startOfDayTs(now);
    const yesterday0 = today0 - 86_400_000;
    const week7Start = today0 - 7 * 86_400_000;

    // Pulse 24h — logs SUCCESS por hora
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

    // Se não houver logs suficientes, estimar usando campanhas criadas
    const totalPulse = hourBuckets.reduce((a, v) => a + v, 0);
    if (totalPulse === 0 && campaigns.length > 0) {
      // Distribuir successCount por hora aproximada baseada em createdAt
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

    // Comparativo: hoje / ontem / média 7d
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
      yesterdaySent === 0
        ? todaySent > 0
          ? 100
          : 0
        : Math.round(((todaySent - yesterdaySent) / yesterdaySent) * 100);
    const deltaVsAvg =
      avg7d === 0 ? (todaySent > 0 ? 100 : 0) : Math.round(((todaySent - avg7d) / avg7d) * 100);

    // Top 3 por taxa de sucesso (min 30 processados)
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

    // Últimas 5 campanhas (gantt)
    const recent = [...campaigns]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    return {
      hourBuckets,
      todaySent,
      yesterdaySent,
      avg7d,
      deltaVsYesterday,
      deltaVsAvg,
      ranked,
      recent
    };
  }, [campaigns]);

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

  const runningCampaigns = campaigns.filter((c) => c.status === CampaignStatus.RUNNING);
  const pausedCampaigns = campaigns.filter((c) => c.status === CampaignStatus.PAUSED);
  const onlineChips = connections.filter((c) => c.status === ConnectionStatus.CONNECTED).length;

  return (
    <div className="space-y-4">
      {/* ─── Pulse 24h + Comparativos ─── */}
      <div className="grid grid-cols-12 gap-3">
        {/* Pulse 24h (wide) */}
        <Card className="col-span-12 lg:col-span-7">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  background: 'linear-gradient(135deg, rgba(16,185,129,0.22), rgba(59,130,246,0.16))',
                  border: '1px solid rgba(16,185,129,0.3)'
                }}
              >
                <Activity className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
              </div>
              <div className="min-w-0">
                <h3 className="ui-title text-[14.5px] truncate">Pulso das últimas 24h</h3>
                <p className="text-[11.5px] truncate" style={{ color: 'var(--text-3)' }}>
                  Envios bem-sucedidos por hora
                </p>
              </div>
            </div>
            <span
              className="text-[11.5px] font-bold tabular-nums px-2 py-1 rounded-lg flex items-center gap-1"
              style={{
                background: 'rgba(16,185,129,0.12)',
                color: 'var(--brand-600)',
                border: '1px solid rgba(16,185,129,0.25)'
              }}
            >
              <Clock className="w-3 h-3" />
              {fmtInt(data.hourBuckets.reduce((a, v) => a + v, 0))} nas últimas 24h
            </span>
          </div>
          <PulseChart
            values={data.hourBuckets}
            height={140}
            color="var(--brand-500)"
            labels={['-24h', '-18h', '-12h', '-6h', 'agora']}
          />
        </Card>

        {/* Comparativos (narrow) */}
        <div className="col-span-12 lg:col-span-5 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
          <DeltaCard
            label="Hoje"
            value={data.todaySent}
            delta={data.deltaVsYesterday}
            deltaLabel="vs ontem"
            sub={`Ontem: ${fmtInt(data.yesterdaySent)}`}
            tone="#10b981"
          />
          <DeltaCard
            label="Média 7 dias"
            value={data.avg7d}
            delta={data.deltaVsAvg}
            deltaLabel="vs média"
            sub={`Últimos 7d: ${fmtInt(data.avg7d * 7)}`}
            tone="#3b82f6"
          />
          <DeltaCard
            label="Em execução"
            value={runningCampaigns.length}
            sub={`${pausedCampaigns.length} pausada${pausedCampaigns.length === 1 ? '' : 's'} · ${onlineChips} chip${onlineChips === 1 ? '' : 's'} online`}
            tone={runningCampaigns.length > 0 ? '#ef4444' : 'var(--text-3)'}
            live={runningCampaigns.length > 0}
          />
        </div>
      </div>

      {/* ─── Top 3 pódio + Gantt recentes ─── */}
      <div className="grid grid-cols-12 gap-3">
        {/* Podium Top 3 */}
        <Card className="col-span-12 lg:col-span-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg, rgba(251,191,36,0.22), rgba(239,68,68,0.1))',
                border: '1px solid rgba(251,191,36,0.35)'
              }}
            >
              <Crown className="w-4 h-4" style={{ color: '#f59e0b' }} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="ui-title text-[14.5px]">Pódio de campanhas</h3>
              <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                Top 3 por taxa de sucesso
              </p>
            </div>
          </div>

          {data.ranked.length === 0 ? (
            <div
              className="text-center py-8 px-4 rounded-xl"
              style={{
                background: 'var(--surface-1)',
                border: '1px dashed var(--border-subtle)'
              }}
            >
              <Award className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-3)' }} />
              <p className="text-[12.5px]" style={{ color: 'var(--text-3)' }}>
                Precisa de pelo menos 30 envios processados para entrar no ranking.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.ranked.map((camp, i) => {
                const rate = getCampaignProgressMetrics(camp).successRatePct;
                return (
                  <PodiumRow
                    key={camp.id}
                    rank={i + 1}
                    name={camp.name}
                    rate={rate}
                    sent={camp.successCount}
                    total={camp.totalContacts}
                    onClick={() => onOpenDetails(camp.id)}
                  />
                );
              })}
            </div>
          )}
        </Card>

        {/* Gantt últimas 5 campanhas */}
        <Card className="col-span-12 lg:col-span-7">
          <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, rgba(59,130,246,0.22), rgba(139,92,246,0.16))',
                  border: '1px solid rgba(59,130,246,0.3)'
                }}
              >
                <Rocket className="w-4 h-4" style={{ color: '#3b82f6' }} />
              </div>
              <div>
                <h3 className="ui-title text-[14.5px]">Últimas campanhas</h3>
                <p className="text-[11.5px]" style={{ color: 'var(--text-3)' }}>
                  Progresso e status em paralelo
                </p>
              </div>
            </div>
            <button
              onClick={onViewAll}
              className="text-[11.5px] font-bold flex items-center gap-1 transition-colors px-2 py-1 rounded-md hover:bg-[var(--surface-1)]"
              style={{ color: 'var(--brand-600)' }}
            >
              Ver todas <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-2.5">
            {data.recent.map((camp) => (
              <GanttRow key={camp.id} campaign={camp} onClick={() => onOpenDetails(camp.id)} />
            ))}
          </div>
        </Card>
      </div>

      {/* ─── Resumo rodapé: ativas / pausadas se relevante ─── */}
      {(runningCampaigns.length > 0 || pausedCampaigns.length > 0) && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              <h3 className="ui-title text-[14px]">Operações em curso</h3>
              <Badge variant="neutral">{runningCampaigns.length + pausedCampaigns.length}</Badge>
            </div>
            <button
              onClick={onViewAll}
              className="text-[11.5px] font-semibold flex items-center gap-1 transition-colors"
              style={{ color: 'var(--brand-600)' }}
            >
              Lista completa <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {[...runningCampaigns, ...pausedCampaigns].slice(0, 4).map((camp) => {
              const progress = getCampaignProgressMetrics(camp).progressPct;
              const isRunning = camp.status === CampaignStatus.RUNNING;
              return (
                <button
                  key={camp.id}
                  className="text-left rounded-xl p-3 transition-all hover:-translate-y-0.5 hover:shadow-lg"
                  style={{
                    border: `1px solid ${isRunning ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}`,
                    background: isRunning
                      ? 'linear-gradient(135deg, rgba(16,185,129,0.06), transparent)'
                      : 'linear-gradient(135deg, rgba(245,158,11,0.06), transparent)'
                  }}
                  onClick={() => onOpenDetails(camp.id)}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                        {camp.name}
                      </p>
                      <div
                        className="flex items-center gap-2 text-[11px] mt-0.5"
                        style={{ color: 'var(--text-3)' }}
                      >
                        <span className="flex items-center gap-1">
                          <Smartphone className="w-3 h-3" />
                          {camp.selectedConnectionIds.length}
                        </span>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {fmtInt(camp.totalContacts)}
                        </span>
                      </div>
                    </div>
                    <Badge variant={isRunning ? 'success' : 'warning'} dot={isRunning}>
                      {isRunning ? 'Ativa' : 'Pausada'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${progress}%`,
                          background: isRunning ? 'var(--brand-500)' : '#f59e0b'
                        }}
                      />
                    </div>
                    <span
                      className="text-[11.5px] font-bold tabular-nums w-10 text-right"
                      style={{ color: isRunning ? 'var(--brand-600)' : '#f59e0b' }}
                    >
                      {progress}%
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
};

// ─── Delta Card ───
const DeltaCard: React.FC<{
  label: string;
  value: number;
  delta?: number;
  deltaLabel?: string;
  sub?: string;
  tone: string;
  live?: boolean;
}> = ({ label, value, delta, deltaLabel, sub, tone, live }) => {
  const isPositive = delta !== undefined && delta >= 0;
  return (
    <div
      className="rounded-xl p-3.5 relative overflow-hidden"
      style={{
        background: 'var(--surface-0)',
        border: `1px solid ${tone}33`
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none opacity-70"
        style={{ background: `radial-gradient(140px 70px at 100% 0%, ${tone}22, transparent 70%)` }}
        aria-hidden
      />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className="text-[9.5px] font-extrabold uppercase tracking-[0.14em] flex items-center gap-1.5"
            style={{ color: 'var(--text-3)' }}
          >
            {label}
            {live && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
          </p>
          <p
            className="text-[26px] font-black tabular-nums leading-none mt-1"
            style={{ color: 'var(--text-1)' }}
          >
            {fmtInt(value)}
          </p>
          {sub && (
            <p className="text-[10.5px] mt-1 leading-snug truncate" style={{ color: 'var(--text-3)' }}>
              {sub}
            </p>
          )}
        </div>
        {delta !== undefined && (
          <div
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10.5px] font-bold tabular-nums shrink-0"
            style={{
              background: isPositive ? 'rgba(16,185,129,0.14)' : 'rgba(239,68,68,0.14)',
              color: isPositive ? '#059669' : '#dc2626',
              border: `1px solid ${isPositive ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`
            }}
            title={deltaLabel}
          >
            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {isPositive ? '+' : ''}
            {delta}%
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Podium Row ───
const PodiumRow: React.FC<{
  rank: number;
  name: string;
  rate: number;
  sent: number;
  total: number;
  onClick: () => void;
}> = ({ rank, name, rate, sent, total, onClick }) => {
  const medal =
    rank === 1
      ? { icon: <Crown className="w-3.5 h-3.5" />, tone: '#f59e0b', bg: 'linear-gradient(135deg, #fbbf24, #f59e0b)' }
      : rank === 2
      ? { icon: <Medal className="w-3.5 h-3.5" />, tone: '#94a3b8', bg: 'linear-gradient(135deg, #cbd5e1, #94a3b8)' }
      : { icon: <Medal className="w-3.5 h-3.5" />, tone: '#cd7f32', bg: 'linear-gradient(135deg, #f59e0b, #b45309)' };
  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl p-3 flex items-center gap-3 transition-all hover:-translate-y-0.5 hover:shadow-md text-left"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-white"
        style={{ background: medal.bg, boxShadow: `0 4px 10px -2px ${medal.tone}66` }}
      >
        {medal.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
          {name}
        </p>
        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          {fmtInt(sent)} / {fmtInt(total)}
        </p>
      </div>
      <div
        className="text-[14px] font-black tabular-nums px-2 py-1 rounded-lg shrink-0"
        style={{
          background: `${medal.tone}22`,
          color: medal.tone,
          border: `1px solid ${medal.tone}44`
        }}
      >
        {rate}%
      </div>
    </button>
  );
};

// ─── Gantt Row ───
const GanttRow: React.FC<{ campaign: Campaign; onClick: () => void }> = ({ campaign, onClick }) => {
  const progress = getCampaignProgressMetrics(campaign).progressPct;
  const isRunning = campaign.status === CampaignStatus.RUNNING;
  const isPaused = campaign.status === CampaignStatus.PAUSED;
  const isDone = campaign.status === CampaignStatus.COMPLETED;

  const color = isRunning
    ? 'var(--brand-500)'
    : isPaused
    ? '#f59e0b'
    : isDone
    ? '#3b82f6'
    : '#94a3b8';

  const statusLabel = isRunning ? 'Em execução' : isPaused ? 'Pausada' : isDone ? 'Concluída' : 'Pendente';
  const created = campaign.createdAt ? new Date(campaign.createdAt) : null;

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl p-2.5 transition-all hover:bg-[var(--surface-1)]"
      style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-0)' }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
        <p className="text-[12.5px] font-bold truncate flex-1" style={{ color: 'var(--text-1)' }}>
          {campaign.name}
        </p>
        <span
          className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md shrink-0"
          style={{
            background: `${color}22`,
            color,
            border: `1px solid ${color}44`
          }}
        >
          {statusLabel}
        </span>
        <span
          className="text-[10.5px] font-bold tabular-nums w-10 text-right shrink-0"
          style={{ color }}
        >
          {progress}%
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div
          className="flex-1 h-2 rounded-full overflow-hidden relative"
          style={{ background: 'var(--surface-2)' }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
            style={{
              width: `${progress}%`,
              background: isRunning
                ? `linear-gradient(90deg, ${color}, #34d399)`
                : color
            }}
          />
          {isRunning && (
            <div
              className="absolute inset-y-0 w-6 opacity-70 pointer-events-none"
              style={{
                left: `calc(${progress}% - 24px)`,
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)',
                animation: 'pulse 1.6s ease-in-out infinite'
              }}
            />
          )}
        </div>
        <span
          className="text-[10.5px] tabular-nums shrink-0 w-[110px] text-right"
          style={{ color: 'var(--text-3)' }}
        >
          {created ? created.toLocaleDateString('pt-BR') : '—'} · {fmtInt(campaign.totalContacts)}
        </span>
      </div>
    </button>
  );
};
