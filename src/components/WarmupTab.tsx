import React, { useState, useEffect, useRef } from 'react';
import {
  Flame, Play, Pause, ToggleLeft, ToggleRight, TrendingUp, MessageCircle, Clock, Zap, RefreshCw, AlertTriangle,
  BarChart3, CalendarDays, ArrowUpRight, ArrowDownRight, Trash2, X, CheckCircle2, AlertCircle
} from 'lucide-react';
import { useZapMass } from '../context/ZapMassContext';
import { ConnectionStatus, WarmupChipStats } from '../types';
import { Badge, Button, Card, EmptyState, Modal, SectionHeader, StatCard } from './ui';

interface WarmupChannel {
  connectionId: string;
  name: string;
  phoneNumber: string;
  enabled: boolean;
  score: number;
  messagesSent: number;
  messagesReceived: number;
  status: 'idle' | 'warming' | 'paused';
  lastActivity: string;
}

const WARMUP_MESSAGES = [
  'Oi, tudo bem?',
  'Bom dia! Como vai?',
  'Boa tarde!',
  'Olá! Tudo certo por aí?',
  'E aí, como tá o dia?',
  'Fala! Beleza?',
  'Oi! Quanto tempo!',
  'Ei, tudo tranquilo?',
  'Opa! Como está?',
  'Bom dia! Tudo bem com você?',
  'Boa noite! Como foi o dia?',
  'Olá! Alguma novidade?',
  'Oi! Saudades!',
  'Como vai a semana?',
  'Tudo certo?',
  'Fala aí! Sumiu hein!',
  'Opa, e aí?',
  'Olá! Passando pra dar um oi!',
  'Boa! Como tá?',
  'Ei! Vamos conversar?'
];

const getRandomMessage = () => WARMUP_MESSAGES[Math.floor(Math.random() * WARMUP_MESSAGES.length)];

const getScoreColor = (score: number) => {
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#f59e0b';
  if (score >= 40) return '#f97316';
  return '#ef4444';
};

const getScoreLabel = (score: number) => {
  if (score >= 80) return 'Excelente';
  if (score >= 60) return 'Bom';
  if (score >= 40) return 'Regular';
  return 'Baixo';
};

// ============================================================
// HELPERS DE MATURIDADE / HISTORICO (baseados nos dados do servidor)
// ============================================================
type MaturityTier = 'novato' | 'morno' | 'quente' | 'premium';
interface Maturity {
  tier: MaturityTier;
  label: string;
  color: string;
  bg: string;
  dailyTarget: number;
  progress: number; // 0-100
  days: number;
}

const computeMaturity = (stats?: WarmupChipStats): Maturity => {
  if (!stats || !stats.firstWarmedAt) {
    return { tier: 'novato', label: 'Novato', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', dailyTarget: 20, progress: 0, days: 0 };
  }
  const days = Math.max(0, Math.floor((Date.now() - stats.firstWarmedAt) / 86_400_000));
  if (days < 3) return { tier: 'novato', label: 'Novato', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', dailyTarget: 20, progress: (days / 3) * 100, days };
  if (days < 7) return { tier: 'morno', label: 'Morno', color: '#f97316', bg: 'rgba(249,115,22,0.12)', dailyTarget: 50, progress: ((days - 3) / 4) * 100, days };
  if (days < 21) return { tier: 'quente', label: 'Quente', color: '#10b981', bg: 'rgba(16,185,129,0.12)', dailyTarget: 120, progress: ((days - 7) / 14) * 100, days };
  return { tier: 'premium', label: 'Premium', color: '#8b5cf6', bg: 'rgba(139,92,246,0.14)', dailyTarget: 250, progress: 100, days };
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getTodayCounts = (stats?: WarmupChipStats) => {
  const key = todayStr();
  const row = stats?.dailyHistory?.find((d) => d.date === key);
  return {
    sent: row?.sent || 0,
    received: row?.received || 0,
    failed: row?.failed || 0
  };
};

// Retorna os ultimos N dias preenchendo zeros para dias vazios
const getLastNDays = (stats: WarmupChipStats | undefined, n: number) => {
  const out: { date: string; sent: number; received: number; failed: number }[] = [];
  const dict = new Map((stats?.dailyHistory || []).map((d) => [d.date, d]));
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const entry = dict.get(key);
    out.push({ date: key, sent: entry?.sent || 0, received: entry?.received || 0, failed: entry?.failed || 0 });
  }
  return out;
};

const formatLastActive = (ts?: number) => {
  if (!ts) return 'Nunca';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Agora mesmo';
  if (diff < 3_600_000) return `Há ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `Há ${Math.floor(diff / 3_600_000)} h`;
  return `Há ${Math.floor(diff / 86_400_000)} dia(s)`;
};

// Sparkline simples em SVG — sem dependencia externa
const Sparkline: React.FC<{ values: number[]; color?: string; width?: number; height?: number }> = ({
  values,
  color = '#f97316',
  width = 120,
  height = 28
}) => {
  if (!values.length) return <div style={{ width, height }} />;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((v, i) => `${i * step},${height - (v / max) * (height - 4) - 2}`)
    .join(' ');
  const lastX = (values.length - 1) * step;
  const lastY = height - (values[values.length - 1] / max) * (height - 4) - 2;
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`sparkFill-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={`0,${height} ${points} ${lastX},${height}`}
        fill={`url(#sparkFill-${color.replace('#', '')})`}
        stroke="none"
      />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
};

export const WarmupTab: React.FC = () => {
  const {
    connections, socket, warmupActive, warmupNextRound, startWarmupTimer, stopWarmupTimer,
    warmupQueue, warmedCount, warmupChipStats, clearWarmupChipStats
  } = useZapMass();
  const [channels, setChannels] = useState<WarmupChannel[]>([]);
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [totalMessagesSent, setTotalMessagesSent] = useState(0);
  const [lastRoundTime, setLastRoundTime] = useState<string>('');
  const [selectedChipId, setSelectedChipId] = useState<string | null>(null);
  const [confirmClearId, setConfirmClearId] = useState<string | null>(null);
  const channelsRef = useRef<WarmupChannel[]>([]);

  // Keep ref in sync so context timer callback can access latest channels
  useEffect(() => { channelsRef.current = channels; }, [channels]);

  // Sincronizar canais com conexões disponíveis
  useEffect(() => {
    const connectedChannels = connections.filter(c => c.status === ConnectionStatus.CONNECTED);
    setChannels(prev => {
      const updated = connectedChannels.map(conn => {
        const existing = prev.find(ch => ch.connectionId === conn.id);
        return existing || {
          connectionId: conn.id,
          name: conn.name,
          phoneNumber: conn.phoneNumber || '',
          enabled: false,
          score: 0,
          messagesSent: 0,
          messagesReceived: 0,
          status: 'idle' as const,
          lastActivity: ''
        };
      });
      return updated;
    });
  }, [connections]);

  // Carregar estado salvo
  useEffect(() => {
    try {
      const saved = localStorage.getItem('zapmass.warmup.state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.channels) {
          setChannels(prev => prev.map(ch => {
            const savedCh = parsed.channels.find((s: WarmupChannel) => s.connectionId === ch.connectionId);
            return savedCh ? { ...ch, ...savedCh, status: 'idle' as const } : ch;
          }));
        }
        if (parsed.totalMessagesSent) setTotalMessagesSent(parsed.totalMessagesSent);
        if (parsed.intervalMinutes) setIntervalMinutes(parsed.intervalMinutes);
      }
    } catch {}
  }, []);

  // Salvar estado
  useEffect(() => {
    try {
      localStorage.setItem('zapmass.warmup.state', JSON.stringify({
        channels: channels.map(ch => ({
          connectionId: ch.connectionId,
          enabled: ch.enabled,
          score: ch.score,
          messagesSent: ch.messagesSent,
          messagesReceived: ch.messagesReceived,
        })),
        totalMessagesSent,
        intervalMinutes
      }));
    } catch {}
  }, [channels, totalMessagesSent, intervalMinutes]);

  const toggleChannel = (connectionId: string) => {
    setChannels(prev => prev.map(ch =>
      ch.connectionId === connectionId ? { ...ch, enabled: !ch.enabled } : ch
    ));
  };

  const getEnabledPairs = (): [WarmupChannel, WarmupChannel][] => {
    const enabled = channels.filter(ch => ch.enabled);
    const pairs: [WarmupChannel, WarmupChannel][] = [];
    for (let i = 0; i < enabled.length; i++) {
      for (let j = i + 1; j < enabled.length; j++) {
        pairs.push([enabled[i], enabled[j]]);
      }
    }
    return pairs;
  };

  const runWarmupRound = async () => {
    const pairs = getEnabledPairs();
    if (pairs.length === 0) return;

    setChannels(prev => prev.map(ch => ch.enabled ? { ...ch, status: 'warming' as const } : ch));

    for (const [a, b] of pairs) {
      // A envia para B
      const msgAtoB = getRandomMessage();
      socket?.emit('warmup-send', { from: a.connectionId, to: b.phoneNumber, message: msgAtoB });

      // Delay aleatório 3-8s
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000));

      // B responde para A
      const msgBtoA = getRandomMessage();
      socket?.emit('warmup-send', { from: b.connectionId, to: a.phoneNumber, message: msgBtoA });

      await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
    }

    // Atualizar scores
    setChannels(prev => prev.map(ch => {
      if (!ch.enabled) return ch;
      const newSent = ch.messagesSent + pairs.filter(([a, b]) => a.connectionId === ch.connectionId || b.connectionId === ch.connectionId).length;
      const newReceived = ch.messagesReceived + pairs.filter(([a, b]) => a.connectionId === ch.connectionId || b.connectionId === ch.connectionId).length;
      const newScore = Math.min(100, Math.round((newSent + newReceived) / 2));
      return {
        ...ch,
        messagesSent: newSent,
        messagesReceived: newReceived,
        score: newScore,
        status: 'idle' as const,
        lastActivity: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      };
    }));

    const totalInRound = pairs.length * 2;
    setTotalMessagesSent(prev => prev + totalInRound);
    setLastRoundTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
  };

  const startGlobalWarmup = () => {
    const pairs = getEnabledPairs();
    if (pairs.length === 0) return;
    // Use context timer so it persists across tab switches
    startWarmupTimer(intervalMinutes, runWarmupRound);
  };

  const stopGlobalWarmup = () => {
    stopWarmupTimer();
    setChannels(prev => prev.map(ch => ({ ...ch, status: 'idle' as const })));
  };

  const enabledCount = channels.filter(ch => ch.enabled).length;
  const pairsCount = getEnabledPairs().length;
  const avgScore = channels.filter(ch => ch.enabled).length > 0
    ? Math.round(channels.filter(ch => ch.enabled).reduce((acc, ch) => acc + ch.score, 0) / channels.filter(ch => ch.enabled).length)
    : 0;

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-5 pb-10">
      <SectionHeader
        eyebrow={<><Flame className="w-3 h-3" />Aquecimento</>}
        title="Aquecer Numeros"
        description="Seus canais conversam entre si automaticamente para elevar o score e evitar bloqueios."
        icon={<Flame className="w-5 h-5" style={{ color: '#f97316' }} />}
        actions={
          warmupActive ? (
            <Button variant="danger" size="lg" leftIcon={<Pause className="w-4 h-4" />} onClick={stopGlobalWarmup}>
              Parar Aquecimento
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              leftIcon={<Play className="w-4 h-4" />}
              disabled={enabledCount < 2}
              onClick={startGlobalWarmup}
              style={
                enabledCount >= 2
                  ? { background: 'linear-gradient(135deg, #f97316, #ea580c)', color: '#fff', boxShadow: '0 4px 20px rgba(249,115,22,0.35)' }
                  : undefined
              }
            >
              Iniciar Aquecimento
            </Button>
          )
        }
      />

      <div
        className="flex gap-3 rounded-xl px-4 py-3 text-[12px] leading-relaxed items-start border"
        style={{
          borderColor: 'rgba(249,115,22,0.35)',
          background: 'linear-gradient(135deg, rgba(249,115,22,0.12), rgba(234,88,12,0.06))',
          color: 'var(--text-2)'
        }}
        role="status"
      >
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#ea580c' }} aria-hidden />
        <div>
          <strong style={{ color: 'var(--text-1)' }}>Precisa do 2º canal em diante.</strong>{' '}
          O aquecimento só faz efeito quando há <strong>pelo menos dois números</strong> ligados — as conversas cruzadas
          acontecem <em>entre</em> canais. Com um único canal o botão &quot;Iniciar aquecimento&quot; fica bloqueado.
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Canais ativos"
          value={enabledCount}
          icon={<Flame className="w-4 h-4" />}
          helper={`${pairsCount} pares formados`}
          accent="warning"
        />
        <StatCard
          label="Score medio"
          value={`${avgScore}%`}
          icon={<TrendingUp className="w-4 h-4" />}
          helper={getScoreLabel(avgScore)}
          accent={avgScore >= 80 ? 'success' : avgScore >= 40 ? 'warning' : 'danger'}
        />
        <StatCard
          label="Msgs trocadas"
          value={totalMessagesSent}
          icon={<MessageCircle className="w-4 h-4" />}
          helper={lastRoundTime ? `Ultima: ${lastRoundTime}` : 'Nenhuma rodada'}
          accent="info"
        />
        <StatCard
          label="Proxima rodada"
          value={warmupActive ? formatCountdown(warmupNextRound) : '--:--'}
          icon={<Clock className="w-4 h-4" />}
          helper={`Fila: ${warmupQueue.length} | Prontos: ${warmedCount}`}
        />
      </div>

      <Card>
        <h3 className="ui-title text-[14px] mb-3">Configuracao do aquecimento</h3>
        <div className="flex flex-wrap items-end gap-5">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-widest mb-2 block" style={{ color: 'var(--text-3)' }}>
              Intervalo entre rodadas
            </label>
            <div className="flex items-center gap-1.5">
              {[3, 5, 10, 15, 30].map((min) => (
                <button
                  key={min}
                  onClick={() => setIntervalMinutes(min)}
                  disabled={warmupActive}
                  className="px-3.5 py-2 rounded-lg text-[12px] font-bold transition-all"
                  style={
                    intervalMinutes === min
                      ? { background: '#f97316', color: '#fff', boxShadow: '0 4px 14px rgba(249,115,22,0.3)' }
                      : { background: 'var(--surface-1)', color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }
                  }
                >
                  {min}min
                </button>
              ))}
            </div>
          </div>

          {enabledCount < 2 && (
            <div
              className="flex items-center gap-2 px-4 py-3 rounded-lg"
              style={{
                background: 'rgba(245,158,11,0.08)',
                border: '1px solid rgba(245,158,11,0.2)'
              }}
            >
              <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: '#f59e0b' }} />
              <span className="text-[12px] font-semibold" style={{ color: '#b45309' }}>
                Ative pelo menos 2 canais para iniciar o aquecimento
              </span>
            </div>
          )}
        </div>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="ui-title text-[14px]">Canais disponiveis</h3>
          <Badge variant="neutral">{channels.length}</Badge>
        </div>

        {channels.length === 0 ? (
          <EmptyState
            icon={<Zap className="w-5 h-5" style={{ color: 'var(--text-3)' }} />}
            title="Nenhum canal conectado"
            description="Conecte pelo menos 2 canais WhatsApp para iniciar o aquecimento."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {channels.map((channel) => {
              const conn = connections.find((c) => c.id === channel.connectionId);
              const isConnected = conn?.status === ConnectionStatus.CONNECTED;
              const chipStats = warmupChipStats[channel.connectionId];
              const maturity = computeMaturity(chipStats);
              const today = getTodayCounts(chipStats);
              const last7 = getLastNDays(chipStats, 7);
              const weeklyTotal = last7.reduce((a, b) => a + b.sent + b.received, 0);
              const prev7 = getLastNDays(chipStats, 14).slice(0, 7);
              const prev7Total = prev7.reduce((a, b) => a + b.sent + b.received, 0);
              const trend = prev7Total === 0 ? (weeklyTotal > 0 ? 100 : 0) : Math.round(((weeklyTotal - prev7Total) / Math.max(1, prev7Total)) * 100);
              const totalMsgs = (chipStats?.totalSent || 0) + (chipStats?.totalReceived || 0);
              const targetProgress = Math.min(100, Math.round(((today.sent + today.received) / maturity.dailyTarget) * 100));
              const derivedScore = chipStats
                ? Math.min(100, Math.round(maturity.days * 3 + totalMsgs * 0.3 + (chipStats.totalFailed > 0 ? -Math.min(15, chipStats.totalFailed) : 0)))
                : channel.score;

              return (
                <div
                  key={channel.connectionId}
                  onClick={() => setSelectedChipId(channel.connectionId)}
                  className="relative overflow-hidden rounded-2xl transition-all duration-300 cursor-pointer hover:-translate-y-0.5"
                  style={{
                    background: 'var(--surface-0)',
                    border: channel.enabled
                      ? '1.5px solid rgba(249,115,22,0.35)'
                      : '1px solid var(--border-subtle)',
                    boxShadow: channel.enabled
                      ? '0 8px 24px rgba(249,115,22,0.1), var(--shadow-sm)'
                      : 'var(--shadow-xs)'
                  }}
                >
                  <div
                    className="absolute top-0 left-0 right-0 h-1"
                    style={{
                      background:
                        channel.status === 'warming'
                          ? 'linear-gradient(90deg, #f97316, #ea580c)'
                          : channel.enabled
                          ? 'rgba(249,115,22,0.4)'
                          : 'var(--surface-2)'
                    }}
                  >
                    {channel.status === 'warming' && (
                      <div className="h-full w-1/3 bg-white/40 animate-[shimmer_1.5s_infinite] rounded-full" />
                    )}
                  </div>

                  <div className="p-4 pt-4">
                    <div className="flex items-start justify-between mb-3 gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0"
                          style={{ border: channel.enabled ? '2px solid #f97316' : '2px solid var(--border-subtle)' }}
                        >
                          {conn?.profilePicUrl ? (
                            <img src={conn.profilePicUrl} className="w-full h-full object-cover" alt="" />
                          ) : (
                            <img
                              src={`https://ui-avatars.com/api/?name=${encodeURIComponent(channel.name)}&background=${channel.enabled ? 'F97316' : '64748B'}&color=fff&size=88&bold=true`}
                              className="w-full h-full object-cover"
                              alt=""
                            />
                          )}
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                            {channel.name}
                          </h4>
                          <p className="text-[11px] font-mono truncate" style={{ color: 'var(--text-3)' }}>
                            {channel.phoneNumber || 'Sem numero'}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={(e) => { e.stopPropagation(); toggleChannel(channel.connectionId); }}
                        disabled={!isConnected || warmupActive}
                        className={`transition-all flex-shrink-0 ${(!isConnected || warmupActive) ? 'opacity-40 cursor-not-allowed' : ''}`}
                      >
                        {channel.enabled ? (
                          <ToggleRight className="w-10 h-10" style={{ color: '#f97316' }} />
                        ) : (
                          <ToggleLeft className="w-10 h-10" style={{ color: 'var(--text-3)' }} />
                        )}
                      </button>
                    </div>

                    {/* Faixa de maturidade + dias + score */}
                    <div className="flex items-center justify-between mb-3 gap-2">
                      <div
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                        style={{ background: maturity.bg, border: `1px solid ${maturity.color}33` }}
                      >
                        <Flame className="w-3 h-3" style={{ color: maturity.color }} />
                        <span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: maturity.color }}>
                          {maturity.label}
                        </span>
                        <span className="text-[10.5px] font-semibold opacity-70" style={{ color: maturity.color }}>
                          • {maturity.days}d
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                          Score
                        </span>
                        <span className="text-[14px] font-extrabold tabular-nums" style={{ color: getScoreColor(derivedScore) }}>
                          {derivedScore}
                        </span>
                      </div>
                    </div>

                    {/* Stats principais do chip */}
                    <div className="grid grid-cols-3 gap-1.5 mb-3">
                      <div
                        className="text-center p-1.5 rounded-lg"
                        style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                      >
                        <span className="text-[9px] font-bold uppercase tracking-wider block" style={{ color: 'var(--text-3)' }}>
                          Hoje
                        </span>
                        <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                          {today.sent + today.received}
                        </span>
                      </div>
                      <div
                        className="text-center p-1.5 rounded-lg"
                        style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                      >
                        <span className="text-[9px] font-bold uppercase tracking-wider block" style={{ color: 'var(--text-3)' }}>
                          7 dias
                        </span>
                        <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                          {weeklyTotal}
                        </span>
                      </div>
                      <div
                        className="text-center p-1.5 rounded-lg"
                        style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                      >
                        <span className="text-[9px] font-bold uppercase tracking-wider block" style={{ color: 'var(--text-3)' }}>
                          Total
                        </span>
                        <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>
                          {totalMsgs}
                        </span>
                      </div>
                    </div>

                    {/* Sparkline ultimos 7 dias + tendencia */}
                    <div
                      className="flex items-center justify-between gap-2 p-2 rounded-lg mb-3"
                      style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                    >
                      <div className="min-w-0">
                        <div className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-3)' }}>
                          Atividade 7d
                        </div>
                        <div className="flex items-center gap-1">
                          {trend >= 0 ? (
                            <ArrowUpRight className="w-3 h-3" style={{ color: '#10b981' }} />
                          ) : (
                            <ArrowDownRight className="w-3 h-3" style={{ color: '#ef4444' }} />
                          )}
                          <span className="text-[11px] font-bold tabular-nums" style={{ color: trend >= 0 ? '#10b981' : '#ef4444' }}>
                            {trend >= 0 ? '+' : ''}{trend}%
                          </span>
                        </div>
                      </div>
                      <Sparkline values={last7.map((d) => d.sent + d.received)} color={maturity.color} width={110} height={28} />
                    </div>

                    {/* Progresso para meta diaria de maturidade */}
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                          Meta diaria ({maturity.dailyTarget})
                        </span>
                        <span className="text-[10px] font-bold tabular-nums" style={{ color: maturity.color }}>
                          {today.sent + today.received}/{maturity.dailyTarget}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${targetProgress}%`,
                            background: `linear-gradient(90deg, ${maturity.color}, ${maturity.color}dd)`
                          }}
                        />
                      </div>
                    </div>

                    {/* Rodape: status + ultima atividade */}
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold uppercase tracking-wider flex items-center gap-1"
                        style={{
                          color:
                            channel.status === 'warming'
                              ? '#f97316'
                              : channel.enabled
                              ? 'var(--brand-600)'
                              : 'var(--text-3)'
                        }}
                      >
                        {channel.status === 'warming' && <RefreshCw className="w-3 h-3 animate-spin" />}
                        {channel.status === 'warming'
                          ? 'Aquecendo...'
                          : channel.enabled
                          ? 'Pronto'
                          : !isConnected
                          ? 'Desconectado'
                          : 'Desativado'}
                      </span>
                      <span className="font-medium" style={{ color: 'var(--text-3)' }}>
                        {formatLastActive(chipStats?.lastActiveAt)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL DE DETALHE DO CHIP ========================================= */}
      {selectedChipId && (() => {
        const channel = channels.find((c) => c.connectionId === selectedChipId);
        const conn = connections.find((c) => c.id === selectedChipId);
        const chipStats = warmupChipStats[selectedChipId];
        const maturity = computeMaturity(chipStats);
        const today = getTodayCounts(chipStats);
        const last30 = getLastNDays(chipStats, 30);
        const last7 = last30.slice(-7);
        const weeklyTotal = last7.reduce((a, b) => a + b.sent + b.received, 0);
        const avgDaily = chipStats && maturity.days > 0 ? Math.round(((chipStats.totalSent + chipStats.totalReceived) / Math.max(1, maturity.days))) : 0;
        const maxDay = Math.max(1, ...last30.map((d) => d.sent + d.received));
        const failureRate = chipStats && chipStats.totalSent + chipStats.totalFailed > 0
          ? Math.round((chipStats.totalFailed / (chipStats.totalSent + chipStats.totalFailed)) * 100)
          : 0;
        const healthOk = failureRate < 10 && maturity.days > 0;

        return (
          <Modal isOpen={true} onClose={() => setSelectedChipId(null)} title="" size="lg">
            <div className="space-y-5">
              {/* Cabecalho com avatar + nome + maturidade */}
              <div
                className="flex items-center gap-4 p-4 rounded-2xl"
                style={{
                  background: `linear-gradient(135deg, ${maturity.color}18, ${maturity.color}05)`,
                  border: `1px solid ${maturity.color}33`
                }}
              >
                <div className="w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0" style={{ border: `3px solid ${maturity.color}` }}>
                  {conn?.profilePicUrl ? (
                    <img src={conn.profilePicUrl} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <img
                      src={`https://ui-avatars.com/api/?name=${encodeURIComponent(channel?.name || 'WA')}&background=F97316&color=fff&size=128&bold=true`}
                      className="w-full h-full object-cover"
                      alt=""
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-[18px] font-bold truncate" style={{ color: 'var(--text-1)' }}>
                      {channel?.name || 'Chip'}
                    </h3>
                    <Badge variant={healthOk ? 'success' : 'warning'}>
                      {healthOk ? <><CheckCircle2 className="w-3 h-3" /> Saudável</> : <><AlertCircle className="w-3 h-3" /> Atenção</>}
                    </Badge>
                  </div>
                  <p className="text-[12px] font-mono mb-1" style={{ color: 'var(--text-3)' }}>
                    {channel?.phoneNumber || 'Sem numero'}
                  </p>
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="flex items-center gap-1 font-bold" style={{ color: maturity.color }}>
                      <Flame className="w-3 h-3" /> {maturity.label}
                    </span>
                    <span className="font-semibold" style={{ color: 'var(--text-2)' }}>
                      <CalendarDays className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                      {maturity.days} dia(s) aquecendo
                    </span>
                    <span className="font-semibold" style={{ color: 'var(--text-2)' }}>
                      <Clock className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                      {formatLastActive(chipStats?.lastActiveAt)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Linha de progresso da maturidade */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-2)' }}>
                    Progresso para próxima fase
                  </span>
                  <span className="text-[11px] font-bold" style={{ color: maturity.color }}>
                    {maturity.tier === 'premium' ? 'Fase máxima atingida' : `${Math.round(maturity.progress)}%`}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {(['novato', 'morno', 'quente', 'premium'] as MaturityTier[]).map((tier, idx) => {
                    const reached = ['novato', 'morno', 'quente', 'premium'].indexOf(maturity.tier) >= idx;
                    const current = maturity.tier === tier;
                    return (
                      <div
                        key={tier}
                        className="flex-1 h-2 rounded-full transition-all"
                        style={{
                          background: reached
                            ? current
                              ? `linear-gradient(90deg, ${maturity.color}, ${maturity.color}80)`
                              : '#10b981'
                            : 'var(--surface-2)'
                        }}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between mt-1 text-[9.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  <span>Novato</span>
                  <span>Morno</span>
                  <span>Quente</span>
                  <span>Premium</span>
                </div>
              </div>

              {/* KPIs principais */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="p-3 rounded-xl text-center" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>Enviadas</div>
                  <div className="text-[20px] font-extrabold tabular-nums" style={{ color: '#10b981' }}>{chipStats?.totalSent || 0}</div>
                </div>
                <div className="p-3 rounded-xl text-center" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>Recebidas</div>
                  <div className="text-[20px] font-extrabold tabular-nums" style={{ color: '#3b82f6' }}>{chipStats?.totalReceived || 0}</div>
                </div>
                <div className="p-3 rounded-xl text-center" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>Falhas</div>
                  <div className="text-[20px] font-extrabold tabular-nums" style={{ color: '#ef4444' }}>{chipStats?.totalFailed || 0}</div>
                </div>
                <div className="p-3 rounded-xl text-center" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>Média/dia</div>
                  <div className="text-[20px] font-extrabold tabular-nums" style={{ color: 'var(--text-1)' }}>{avgDaily}</div>
                </div>
              </div>

              {/* Grafico de barras 30 dias */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[13px] font-bold flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
                    <BarChart3 className="w-4 h-4" style={{ color: maturity.color }} />
                    Histórico dos últimos 30 dias
                  </h4>
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-3)' }}>
                    Total 7d: <span style={{ color: maturity.color }}>{weeklyTotal}</span>
                  </span>
                </div>
                <div
                  className="p-3 rounded-xl"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                >
                  <div className="flex items-end gap-0.5" style={{ height: 120 }}>
                    {last30.map((d, i) => {
                      const total = d.sent + d.received;
                      const pct = (total / maxDay) * 100;
                      const date = new Date(d.date);
                      const isToday = d.date === todayStr();
                      return (
                        <div key={d.date} className="flex-1 flex flex-col items-center group relative" style={{ minWidth: 4 }}>
                          <div
                            className="w-full rounded-t transition-all duration-300 relative"
                            style={{
                              height: `${Math.max(2, pct)}%`,
                              background: isToday
                                ? `linear-gradient(180deg, ${maturity.color}, ${maturity.color}cc)`
                                : total > 0
                                  ? '#10b98166'
                                  : 'var(--surface-2)'
                            }}
                          >
                            {/* Tooltip */}
                            <div
                              className="opacity-0 group-hover:opacity-100 pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap transition-opacity z-20"
                              style={{ background: 'var(--text-1)', color: 'var(--surface-0)' }}
                            >
                              {date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}: {total} msg
                            </div>
                          </div>
                          {i % 5 === 0 && (
                            <span className="text-[8px] font-bold mt-1" style={{ color: 'var(--text-3)' }}>
                              {date.getDate()}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Recomendacoes */}
              <div
                className="p-3 rounded-xl"
                style={{ background: maturity.bg, border: `1px solid ${maturity.color}33` }}
              >
                <div className="flex items-start gap-2">
                  <TrendingUp className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: maturity.color }} />
                  <div className="text-[11.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                    <strong style={{ color: maturity.color }}>Recomendação:</strong>{' '}
                    {maturity.tier === 'novato' && 'Mantenha volumes baixos (até 20 msg/dia). Evite disparos agora — aguarde ao menos 3 dias de aquecimento.'}
                    {maturity.tier === 'morno' && 'Pode começar disparos leves (até 50 msg/dia). Continue aquecendo entre chips para subir para "Quente".'}
                    {maturity.tier === 'quente' && 'Chip em boa forma — pode fazer disparos médios (até 120 msg/dia). Em +2 semanas atinge Premium.'}
                    {maturity.tier === 'premium' && 'Chip premium! Pode operar com volumes altos (até 250 msg/dia) com baixo risco de bloqueio.'}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="text-center">
                    <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Hoje</div>
                    <div className="text-[14px] font-extrabold" style={{ color: maturity.color }}>{today.sent + today.received}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Meta diária</div>
                    <div className="text-[14px] font-extrabold" style={{ color: 'var(--text-1)' }}>{maturity.dailyTarget}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Taxa falha</div>
                    <div className="text-[14px] font-extrabold" style={{ color: failureRate < 5 ? '#10b981' : failureRate < 15 ? '#f59e0b' : '#ef4444' }}>{failureRate}%</div>
                  </div>
                </div>
              </div>

              {/* Acoes */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <Button variant="ghost" size="sm" leftIcon={<Trash2 className="w-4 h-4" />} onClick={() => setConfirmClearId(selectedChipId)}>
                  Zerar histórico deste chip
                </Button>
                <Button variant="secondary" size="sm" leftIcon={<X className="w-4 h-4" />} onClick={() => setSelectedChipId(null)}>
                  Fechar
                </Button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* CONFIRMAR ZERAR HISTORICO ===================================== */}
      <Modal
        isOpen={!!confirmClearId}
        onClose={() => setConfirmClearId(null)}
        title="Zerar histórico de aquecimento"
        icon={<AlertTriangle className="w-5 h-5" style={{ color: '#f59e0b' }} />}
      >
        <div className="space-y-4">
          <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
            Isso apaga permanentemente o histórico de aquecimento deste chip (dias aquecendo,
            mensagens trocadas, curva de 30 dias). O chip voltará para o nível <strong>Novato</strong>.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmClearId(null)}>Cancelar</Button>
            <Button
              variant="danger"
              size="sm"
              leftIcon={<Trash2 className="w-4 h-4" />}
              onClick={() => {
                if (confirmClearId) clearWarmupChipStats(confirmClearId);
                setConfirmClearId(null);
                setSelectedChipId(null);
              }}
            >
              Zerar histórico
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
