import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Flame, Play, Pause, TrendingUp, MessageCircle, Clock, Zap, RefreshCw, AlertTriangle,
  BarChart3, CalendarDays, ArrowUpRight, ArrowDownRight, Trash2, X, CheckCircle2,
  AlertCircle, Timer, Wifi, WifiOff, Target, Activity, Sparkles
} from 'lucide-react';
import { useZapMassCore } from '../context/ZapMassContext';
import { useAuth } from '../context/AuthContext';
import { ConnectionStatus, WarmupChipStats } from '../types';
import { brazilDayKey } from '../utils/channelDispatchInsights';
import toast from 'react-hot-toast';
import { Badge, Button, Card, EmptyState, Modal, PageShell } from './ui';

// ─── Tipos ─────────────────────────────────────────────────────────────────
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
  'Oi, tudo bem?', 'Bom dia! Como vai?', 'Boa tarde!', 'Olá! Tudo certo por aí?',
  'E aí, como tá o dia?', 'Fala! Beleza?', 'Oi! Quanto tempo!', 'Ei, tudo tranquilo?',
  'Opa! Como está?', 'Bom dia! Tudo bem com você?', 'Boa noite! Como foi o dia?',
  'Olá! Alguma novidade?', 'Oi! Saudades!', 'Como vai a semana?', 'Tudo certo?',
  'Fala aí! Sumiu hein!', 'Opa, e aí?', 'Olá! Passando pra dar um oi!', 'Boa! Como tá?',
  'Ei! Vamos conversar?'
];

const getRandomMessage = () => WARMUP_MESSAGES[Math.floor(Math.random() * WARMUP_MESSAGES.length)];

// ─── Maturidade ─────────────────────────────────────────────────────────────
type MaturityTier = 'novato' | 'morno' | 'quente' | 'premium';
interface Maturity {
  tier: MaturityTier;
  label: string;
  color: string;
  glow: string;
  bg: string;
  gradient: string;
  dailyTarget: number;
  progress: number;
  days: number;
  nextTierDays: number;
  icon: string;
}

const computeMaturity = (stats?: WarmupChipStats): Maturity => {
  const base = {
    novato:  { tier: 'novato'  as const, label: 'Novato',  color: '#f59e0b', glow: 'rgba(245,158,11,0.25)', bg: 'rgba(245,158,11,0.08)',  gradient: 'linear-gradient(135deg, #f59e0b22, #f59e0b08)', dailyTarget: 20,  nextTierDays: 3,  icon: '🌱' },
    morno:   { tier: 'morno'   as const, label: 'Morno',   color: '#f97316', glow: 'rgba(249,115,22,0.25)',  bg: 'rgba(249,115,22,0.08)',   gradient: 'linear-gradient(135deg, #f9731622, #f9731608)', dailyTarget: 50,  nextTierDays: 7,  icon: '🔥' },
    quente:  { tier: 'quente'  as const, label: 'Quente',  color: '#10b981', glow: 'rgba(16,185,129,0.25)',  bg: 'rgba(16,185,129,0.08)',   gradient: 'linear-gradient(135deg, #10b98122, #10b98108)', dailyTarget: 120, nextTierDays: 21, icon: '⚡' },
    premium: { tier: 'premium' as const, label: 'Premium', color: '#8b5cf6', glow: 'rgba(139,92,246,0.25)',  bg: 'rgba(139,92,246,0.08)',   gradient: 'linear-gradient(135deg, #8b5cf622, #8b5cf608)', dailyTarget: 250, nextTierDays: 999, icon: '👑' },
  };
  if (!stats?.firstWarmedAt) return { ...base.novato, progress: 0, days: 0 };
  const days = Math.max(0, Math.floor((Date.now() - stats.firstWarmedAt) / 86_400_000));
  if (days < 3)  return { ...base.novato,  progress: (days / 3)           * 100, days };
  if (days < 7)  return { ...base.morno,   progress: ((days - 3) / 4)     * 100, days };
  if (days < 21) return { ...base.quente,  progress: ((days - 7) / 14)    * 100, days };
  return { ...base.premium, progress: 100, days };
};

const getScoreColor = (score: number) => score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : score >= 40 ? '#f97316' : '#ef4444';
const getScoreLabel = (score: number) => score >= 80 ? 'Excelente' : score >= 60 ? 'Bom' : score >= 40 ? 'Regular' : 'Baixo';

const getLastNDays = (stats: WarmupChipStats | undefined, n: number) => {
  const dict = new Map((stats?.dailyHistory || []).map((d) => [d.date, d]));
  const nowMs = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const key = brazilDayKey(nowMs - (n - 1 - i) * 86_400_000);
    const e = dict.get(key);
    return { date: key, sent: e?.sent || 0, received: e?.received || 0, failed: e?.failed || 0 };
  });
};

const getTodayCounts = (stats?: WarmupChipStats) => {
  const row = stats?.dailyHistory?.find((d) => d.date === brazilDayKey());
  return { sent: row?.sent || 0, received: row?.received || 0, failed: row?.failed || 0 };
};

const formatLastActive = (ts?: number) => {
  if (!ts) return 'Nunca';
  const d = Date.now() - ts;
  if (d < 60_000) return 'Agora mesmo';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}min atrás`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h atrás`;
  return `${Math.floor(d / 86_400_000)}d atrás`;
};

const formatCountdown = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

// ─── Sparkline ───────────────────────────────────────────────────────────────
const Sparkline: React.FC<{ values: number[]; color?: string; width?: number; height?: number }> = ({
  values, color = '#f97316', width = 120, height = 32,
}) => {
  if (!values.length) return <div style={{ width, height }} />;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => `${i * step},${height - (v / max) * (height - 6) - 3}`).join(' ');
  const lx = (values.length - 1) * step;
  const ly = height - (values[values.length - 1] / max) * (height - 6) - 3;
  const gid = `sg-${color.replace('#', '')}`;
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={`0,${height} ${pts} ${lx},${height}`} fill={`url(#${gid})`} stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="3" fill={color} />
    </svg>
  );
};

// ─── Progress Ring SVG ────────────────────────────────────────────────────────
const ProgressRing: React.FC<{ pct: number; color: string; size?: number }> = ({ pct, color, size = 52 }) => {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth="5" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
    </svg>
  );
};

const WARMUP_STATE_KEY = 'zapmass.warmup.state';
const TIERS: MaturityTier[] = ['novato', 'morno', 'quente', 'premium'];
const TIER_COLORS: Record<MaturityTier, string> = { novato: '#f59e0b', morno: '#f97316', quente: '#10b981', premium: '#8b5cf6' };

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════
export const WarmupTab: React.FC = () => {
  const { user } = useAuth();
  const {
    connections, socket, warmupActive, startWarmupTimer, stopWarmupTimer,
    warmupQueue, warmedCount, warmupChipStats, clearWarmupChipStats
  } = useZapMassCore();

  const [channels, setChannels] = useState<WarmupChannel[]>([]);
  const [warmupCountdownUi, setWarmupCountdownUi] = useState(0);
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [lastRoundTime, setLastRoundTime] = useState<string>('');
  const [selectedChipId, setSelectedChipId] = useState<string | null>(null);
  const [confirmClearId, setConfirmClearId] = useState<string | null>(null);
  const channelsRef = useRef<WarmupChannel[]>([]);
  const runWarmupRoundRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => { channelsRef.current = channels; }, [channels]);

  useEffect(() => {
    if (!warmupActive) { setWarmupCountdownUi(0); return; }
    const period = Math.max(60, intervalMinutes * 60);
    setWarmupCountdownUi(period);
    const id = window.setInterval(() => setWarmupCountdownUi((p) => (p <= 1 ? period : p - 1)), 1000);
    return () => window.clearInterval(id);
  }, [warmupActive, intervalMinutes]);

  useEffect(() => {
    const connected = connections.filter((c) => c.status === ConnectionStatus.CONNECTED);
    setChannels((prev) =>
      connected.map((conn) => {
        const ex = prev.find((ch) => ch.connectionId === conn.id);
        return ex || { connectionId: conn.id, name: conn.name, phoneNumber: conn.phoneNumber || '', enabled: false, score: 0, messagesSent: 0, messagesReceived: 0, status: 'idle' as const, lastActivity: '' };
      })
    );
  }, [connections]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(WARMUP_STATE_KEY);
      if (!saved) return;
      const p = JSON.parse(saved);
      const uid = user?.uid || '';
      if (p.savedForUid && uid && p.savedForUid !== uid) return;
      if (p.channels) setChannels((prev) => prev.map((ch) => { const s = p.channels.find((x: WarmupChannel) => x.connectionId === ch.connectionId); return s ? { ...ch, ...s, status: 'idle' as const } : ch; }));
      if (p.intervalMinutes) setIntervalMinutes(p.intervalMinutes);
    } catch {}
  }, [user?.uid]);

  useEffect(() => {
    try {
      localStorage.setItem(WARMUP_STATE_KEY, JSON.stringify({
        savedForUid: user?.uid || undefined,
        warmupTimerActive: warmupActive,
        channels: channels.map((ch) => ({ connectionId: ch.connectionId, enabled: ch.enabled })),
        intervalMinutes,
      }));
    } catch {}
  }, [channels, intervalMinutes, warmupActive, user?.uid]);

  const toggleChannel = (id: string) => setChannels((prev) => prev.map((ch) => ch.connectionId === id ? { ...ch, enabled: !ch.enabled } : ch));

  const getEnabledPairs = (): [WarmupChannel, WarmupChannel][] => {
    const en = channelsRef.current.filter((ch) => ch.enabled);
    const pairs: [WarmupChannel, WarmupChannel][] = [];
    for (let i = 0; i < en.length; i++) for (let j = i + 1; j < en.length; j++) pairs.push([en[i], en[j]]);
    return pairs;
  };

  const runWarmupRound = async () => {
    const pairs = getEnabledPairs();
    if (!pairs.length) return;
    const valid = pairs.filter(([a, b]) => a.phoneNumber?.replace(/\D/g, '') && b.phoneNumber?.replace(/\D/g, ''));
    if (!valid.length) { toast.error('Canais ativos sem número — configure o telefone em Conexões.'); return; }
    if (valid.length < pairs.length) toast('Alguns pares ignorados por falta de número.', { icon: '⚠️' });

    setChannels((prev) => prev.map((ch) => ch.enabled ? { ...ch, status: 'warming' as const } : ch));
    for (const [a, b] of valid) {
      socket?.emit('warmup-send', { from: a.connectionId, to: b.phoneNumber, message: getRandomMessage() });
      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 5000));
      socket?.emit('warmup-send', { from: b.connectionId, to: a.phoneNumber, message: getRandomMessage() });
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
    }
    setChannels((prev) => prev.map((ch) => ch.enabled ? { ...ch, status: 'idle' as const } : ch));
    setLastRoundTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
  };
  runWarmupRoundRef.current = runWarmupRound;

  useEffect(() => {
    if (!socket?.connected || warmupActive) return;
    try {
      const raw = localStorage.getItem(WARMUP_STATE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      const uid = user?.uid || '';
      if (p.savedForUid && uid && p.savedForUid !== uid) return;
      if (!p.warmupTimerActive) return;
    } catch { return; }
    const en = channelsRef.current.filter((c) => c.enabled);
    if (en.length < 2) return;
    startWarmupTimer(intervalMinutes, () => void runWarmupRoundRef.current());
  }, [socket?.connected, warmupActive, intervalMinutes, channels, startWarmupTimer, user?.uid]);

  useEffect(() => {
    if (!socket) return;
    const onErr = (data: { from?: string; to?: string; error?: string }) => {
      const label = connections.find((c) => c.id === data.from)?.name || 'Canal';
      toast.error(`Falha no aquecimento (${label}): ${data.error || 'erro desconhecido'}`);
    };
    socket.on('warmup-send-error', onErr);
    return () => { socket.off('warmup-send-error', onErr); };
  }, [socket, connections]);

  const startGlobalWarmup = () => {
    if (!getEnabledPairs().length) return;
    startWarmupTimer(intervalMinutes, () => void runWarmupRoundRef.current());
  };
  const stopGlobalWarmup = () => {
    stopWarmupTimer();
    setChannels((prev) => prev.map((ch) => ({ ...ch, status: 'idle' as const })));
  };

  const deriveChipScore = (stats?: WarmupChipStats) => {
    if (!stats) return 0;
    const m = computeMaturity(stats);
    return Math.min(100, Math.round(m.days * 3 + (stats.totalSent + stats.totalReceived) * 0.3 - (stats.totalFailed > 0 ? Math.min(15, stats.totalFailed) : 0)));
  };

  const enabledCount = channels.filter((c) => c.enabled).length;
  const pairsCount = getEnabledPairs().length;

  const { todayTotal, totalAllMsgs, avgScore } = useMemo(() => {
    const todayKey = brazilDayKey();
    let todayTotal = 0, totalAllMsgs = 0;
    const scores: number[] = [];
    for (const ch of channels) {
      const s = warmupChipStats[ch.connectionId];
      if (!s) continue;
      const row = s.dailyHistory?.find((d) => d.date === todayKey);
      todayTotal += (row?.sent || 0) + (row?.received || 0);
      totalAllMsgs += s.totalSent + s.totalReceived;
      if (ch.enabled) scores.push(deriveChipScore(s));
    }
    return { todayTotal, totalAllMsgs, avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b) / scores.length) : 0 };
  }, [channels, warmupChipStats]);

  const anyWarming = channels.some((c) => c.status === 'warming');

  return (
    <PageShell
      statusStrip={
        <>
          <Badge variant={warmupActive ? 'success' : 'neutral'} dot>
            {warmupActive ? (anyWarming ? 'Aquecendo agora' : 'Ativo') : 'Parado'}
          </Badge>
          <span className="ui-caption tabular-nums">{enabledCount} chip(s) ativos</span>
          <span className="ui-caption tabular-nums">{pairsCount} par(es)</span>
          {warmupActive && (
            <span className="ui-caption tabular-nums font-bold" style={{ color: '#f97316' }}>
              Próxima: {formatCountdown(warmupCountdownUi)}
            </span>
          )}
        </>
      }
      actions={
        warmupActive ? (
          <Button variant="danger" size="sm" leftIcon={<Pause className="w-4 h-4" />} onClick={stopGlobalWarmup}>
            Parar aquecimento
          </Button>
        ) : (
          <Button variant="primary" size="sm" leftIcon={<Play className="w-4 h-4" />} disabled={enabledCount < 2} onClick={startGlobalWarmup}>
            Iniciar aquecimento
          </Button>
        )
      }
    >
      <div className="space-y-5 pb-12">

        {/* ═══ HERO PANEL ════════════════════════════════════════════════════ */}
        <div
          className="relative overflow-hidden rounded-2xl p-5"
          style={{
            background: warmupActive
              ? 'linear-gradient(135deg, rgba(249,115,22,0.12), rgba(234,88,12,0.06))'
              : 'var(--surface-0)',
            border: warmupActive ? '1.5px solid rgba(249,115,22,0.3)' : '1px solid var(--border-subtle)',
            boxShadow: warmupActive ? '0 8px 32px rgba(249,115,22,0.12)' : 'var(--shadow-xs)',
          }}
        >
          {/* Glow animado quando ativo */}
          {warmupActive && (
            <div
              className="absolute -top-8 -right-8 w-48 h-48 rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.15) 0%, transparent 70%)' }}
            />
          )}

          <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
            {/* Status icon */}
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{
                background: warmupActive ? 'rgba(249,115,22,0.15)' : 'var(--surface-1)',
                border: warmupActive ? '1.5px solid rgba(249,115,22,0.3)' : '1px solid var(--border-subtle)',
              }}
            >
              {warmupActive
                ? <Flame className="w-7 h-7 animate-pulse" style={{ color: '#f97316' }} />
                : <Zap className="w-7 h-7" style={{ color: 'var(--text-3)' }} />
              }
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h2 className="text-[16px] font-bold" style={{ color: 'var(--text-1)' }}>
                  {warmupActive ? (anyWarming ? 'Trocando mensagens agora...' : 'Aguardando próxima rodada') : 'Aquecimento parado'}
                </h2>
                {warmupActive && anyWarming && (
                  <span className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(249,115,22,0.15)', color: '#f97316' }}>
                    <RefreshCw className="w-3 h-3 animate-spin" /> AO VIVO
                  </span>
                )}
              </div>
              <p className="text-[12.5px]" style={{ color: 'var(--text-3)' }}>
                {warmupActive
                  ? `${pairsCount} par(es) trocando mensagens · próxima rodada em ${formatCountdown(warmupCountdownUi)}`
                  : enabledCount < 2
                    ? 'Ative pelo menos 2 chips para iniciar o aquecimento'
                    : `${enabledCount} chip(s) prontos · ${pairsCount} par(es) disponíveis`
                }
              </p>
              {lastRoundTime && (
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  <Clock className="w-3 h-3 inline -mt-0.5 mr-1" />Última rodada: {lastRoundTime}
                </p>
              )}
            </div>

            {/* Métricas rápidas */}
            <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0">
              <div className="text-center">
                <div className="text-[22px] font-extrabold tabular-nums leading-none" style={{ color: warmupActive ? '#f97316' : 'var(--text-1)' }}>
                  {todayTotal}
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-3)' }}>Hoje</div>
              </div>
              <div style={{ width: 1, height: 32, background: 'var(--border-subtle)' }} />
              <div className="text-center">
                <div className="text-[22px] font-extrabold tabular-nums leading-none" style={{ color: getScoreColor(avgScore) }}>
                  {avgScore}
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-3)' }}>Score</div>
              </div>
              <div style={{ width: 1, height: 32, background: 'var(--border-subtle)' }} />
              <div className="text-center">
                <div className="text-[22px] font-extrabold tabular-nums leading-none" style={{ color: 'var(--text-1)' }}>
                  {totalAllMsgs}
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-3)' }}>Total msgs</div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ CONFIGURAÇÃO RÁPIDA ═══════════════════════════════════════════ */}
        <div
          className="flex flex-wrap items-center gap-3 p-3 rounded-xl"
          style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-1.5">
            <Timer className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
            <span className="text-[12px] font-semibold" style={{ color: 'var(--text-2)' }}>Intervalo entre rodadas:</span>
          </div>
          <div className="flex items-center gap-1.5">
            {[3, 5, 10, 15, 30].map((min) => (
              <button
                key={min}
                onClick={() => setIntervalMinutes(min)}
                disabled={warmupActive}
                className="px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all"
                style={
                  intervalMinutes === min
                    ? { background: '#f97316', color: '#fff', boxShadow: '0 2px 8px rgba(249,115,22,0.35)' }
                    : { background: 'var(--surface-1)', color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }
                }
              >
                {min}min
              </button>
            ))}
          </div>
          {enabledCount < 2 && (
            <span className="flex items-center gap-1.5 text-[11.5px] font-medium ml-auto" style={{ color: '#f59e0b' }}>
              <AlertTriangle className="w-3.5 h-3.5" /> Ative pelo menos 2 chips
            </span>
          )}
        </div>

        {/* ═══ LEGENDA DE MATURIDADE ══════════════════════════════════════════ */}
        <div className="flex flex-wrap gap-2">
          {[
            { tier: 'novato', label: 'Novato', sub: '<3 dias · até 20 msg/dia', color: '#f59e0b', icon: '🌱' },
            { tier: 'morno',  label: 'Morno',  sub: '3–7 dias · até 50 msg/dia',  color: '#f97316', icon: '🔥' },
            { tier: 'quente', label: 'Quente', sub: '7–21 dias · até 120 msg/dia', color: '#10b981', icon: '⚡' },
            { tier: 'premium',label: 'Premium',sub: '21+ dias · até 250 msg/dia',  color: '#8b5cf6', icon: '👑' },
          ].map((t) => (
            <div
              key={t.tier}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11.5px] font-semibold"
              style={{ background: `${t.color}12`, border: `1px solid ${t.color}30`, color: t.color }}
            >
              <span>{t.icon}</span>
              <span className="font-bold">{t.label}</span>
              <span className="opacity-70" style={{ color: 'var(--text-3)', fontWeight: 500 }}>{t.sub}</span>
            </div>
          ))}
        </div>

        {/* ═══ TÍTULO SEÇÃO CANAIS ═══════════════════════════════════════════ */}
        <div className="flex items-center justify-between px-0.5">
          <div>
            <h3 className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>Chips disponíveis</h3>
            <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              Ative os chips que deseja aquecer · clique no card para ver detalhes
            </p>
          </div>
          <Badge variant="neutral">{channels.length} chip(s)</Badge>
        </div>

        {/* ═══ GRID DE CHIPS ═════════════════════════════════════════════════ */}
        {channels.length === 0 ? (
          <EmptyState
            icon={<Zap className="w-5 h-5" style={{ color: 'var(--text-3)' }} />}
            title="Nenhum canal conectado"
            description="Conecte pelo menos 2 canais WhatsApp para iniciar o aquecimento."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {channels.map((channel) => {
              const conn = connections.find((c) => c.id === channel.connectionId);
              const isConnected = conn?.status === ConnectionStatus.CONNECTED;
              const chipStats = warmupChipStats[channel.connectionId];
              const maturity = computeMaturity(chipStats);
              const today = getTodayCounts(chipStats);
              const todayTotal = today.sent + today.received;
              const last7 = getLastNDays(chipStats, 7);
              const weeklyTotal = last7.reduce((a, b) => a + b.sent + b.received, 0);
              const prev7 = getLastNDays(chipStats, 14).slice(0, 7).reduce((a, b) => a + b.sent + b.received, 0);
              const trend = prev7 === 0 ? (weeklyTotal > 0 ? 100 : 0) : Math.round(((weeklyTotal - prev7) / Math.max(1, prev7)) * 100);
              const totalMsgs = (chipStats?.totalSent || 0) + (chipStats?.totalReceived || 0);
              const targetPct = Math.min(100, Math.round((todayTotal / maturity.dailyTarget) * 100));
              const score = chipStats ? deriveChipScore(chipStats) : 0;
              const isWarming = channel.status === 'warming';

              return (
                <div
                  key={channel.connectionId}
                  onClick={() => setSelectedChipId(channel.connectionId)}
                  className="relative overflow-hidden rounded-2xl cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                  style={{
                    background: 'var(--surface-0)',
                    border: channel.enabled
                      ? `1.5px solid ${maturity.color}50`
                      : '1px solid var(--border-subtle)',
                    boxShadow: channel.enabled
                      ? `0 4px 20px ${maturity.glow}`
                      : 'var(--shadow-xs)',
                  }}
                >
                  {/* Barra de topo animada */}
                  <div className="h-1 w-full" style={{ background: channel.enabled ? `linear-gradient(90deg, ${maturity.color}, ${maturity.color}80)` : 'var(--surface-2)' }}>
                    {isWarming && <div className="h-full w-1/2 bg-white/50 animate-[shimmer_1.2s_infinite] rounded-full" />}
                  </div>

                  <div className="p-4">
                    {/* Header: avatar + nome + toggle */}
                    <div className="flex items-start justify-between mb-4 gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Avatar com ring colorido */}
                        <div className="relative flex-shrink-0">
                          <div
                            className="w-12 h-12 rounded-xl overflow-hidden"
                            style={{ border: `2.5px solid ${channel.enabled ? maturity.color : 'var(--border-subtle)'}` }}
                          >
                            {conn?.profilePicUrl
                              ? <img src={conn.profilePicUrl} className="w-full h-full object-cover" alt="" />
                              : <img src={`https://ui-avatars.com/api/?name=${encodeURIComponent(channel.name)}&background=${channel.enabled ? maturity.color.replace('#', '') : '64748B'}&color=fff&size=96&bold=true`} className="w-full h-full object-cover" alt="" />
                            }
                          </div>
                          {/* Status dot */}
                          <div
                            className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2"
                            style={{ background: isConnected ? '#10b981' : '#ef4444', borderColor: 'var(--surface-0)' }}
                          />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-[13.5px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{channel.name}</h4>
                          <p className="text-[11px] font-mono truncate" style={{ color: 'var(--text-3)' }}>
                            {channel.phoneNumber || 'Sem número'}
                          </p>
                        </div>
                      </div>

                      {/* Toggle switch personalizado */}
                      <button
                        onClick={(e) => { e.stopPropagation(); if (isConnected && !warmupActive) toggleChannel(channel.connectionId); }}
                        disabled={!isConnected || warmupActive}
                        className={`flex-shrink-0 relative w-11 h-6 rounded-full transition-all duration-300 ${(!isConnected || warmupActive) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                        style={{
                          background: channel.enabled ? maturity.color : 'var(--surface-2)',
                          border: channel.enabled ? `1px solid ${maturity.color}` : '1px solid var(--border-subtle)',
                        }}
                      >
                        <div
                          className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-300"
                          style={{ left: channel.enabled ? '22px' : '2px' }}
                        />
                      </button>
                    </div>

                    {/* Maturidade + Progress Ring */}
                    <div className="flex items-center gap-3 mb-4">
                      <div className="relative flex-shrink-0">
                        <ProgressRing pct={maturity.progress} color={maturity.color} size={52} />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-[13px]">{maturity.icon}</span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[12px] font-black uppercase tracking-wide" style={{ color: maturity.color }}>
                            {maturity.label}
                          </span>
                          <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md" style={{ background: `${maturity.color}15`, color: maturity.color }}>
                            {maturity.days}d
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10.5px] font-bold" style={{ color: getScoreColor(score) }}>
                            Score {score}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>·</span>
                          <span className="text-[10.5px] font-medium" style={{ color: 'var(--text-3)' }}>
                            {maturity.tier === 'premium' ? 'Máximo atingido' : `${Math.round(maturity.progress)}% p/ próx. fase`}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Meta diária com barra */}
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10.5px] font-bold uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
                          <Target className="w-3 h-3" /> Meta diária
                        </span>
                        <span className="text-[11px] font-bold tabular-nums" style={{ color: targetPct >= 100 ? '#10b981' : maturity.color }}>
                          {todayTotal} / {maturity.dailyTarget}
                          {targetPct >= 100 && <CheckCircle2 className="w-3 h-3 inline ml-1" />}
                        </span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${targetPct}%`, background: targetPct >= 100 ? '#10b981' : `linear-gradient(90deg, ${maturity.color}, ${maturity.color}cc)` }}
                        />
                      </div>
                    </div>

                    {/* Stats 3 colunas */}
                    <div className="grid grid-cols-3 gap-1.5 mb-3">
                      {[
                        { label: 'Hoje', val: todayTotal, color: maturity.color },
                        { label: '7 dias', val: weeklyTotal, color: 'var(--text-1)' },
                        { label: 'Total', val: totalMsgs, color: 'var(--text-1)' },
                      ].map(({ label, val, color }) => (
                        <div key={label} className="text-center p-2 rounded-lg" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                          <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>{label}</div>
                          <div className="text-[14px] font-extrabold tabular-nums mt-0.5" style={{ color }}>{val}</div>
                        </div>
                      ))}
                    </div>

                    {/* Sparkline + tendência */}
                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl mb-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                      <div>
                        <div className="text-[9.5px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>7 dias</div>
                        <div className="flex items-center gap-1">
                          {trend >= 0
                            ? <ArrowUpRight className="w-3.5 h-3.5" style={{ color: '#10b981' }} />
                            : <ArrowDownRight className="w-3.5 h-3.5" style={{ color: '#ef4444' }} />
                          }
                          <span className="text-[12px] font-extrabold tabular-nums" style={{ color: trend >= 0 ? '#10b981' : '#ef4444' }}>
                            {trend >= 0 ? '+' : ''}{trend}%
                          </span>
                        </div>
                      </div>
                      <Sparkline values={last7.map((d) => d.sent + d.received)} color={maturity.color} width={100} height={30} />
                    </div>

                    {/* Footer: status + última atividade */}
                    <div className="flex items-center justify-between text-[11px]">
                      <span
                        className="font-semibold uppercase tracking-wide flex items-center gap-1.5"
                        style={{ color: isWarming ? '#f97316' : channel.enabled ? '#10b981' : !isConnected ? '#ef4444' : 'var(--text-3)' }}
                      >
                        {isWarming && <RefreshCw className="w-3 h-3 animate-spin" />}
                        {!isConnected && <WifiOff className="w-3 h-3" />}
                        {channel.enabled && !isWarming && isConnected && <Wifi className="w-3 h-3" />}
                        {isWarming ? 'Aquecendo...' : channel.enabled ? 'Pronto' : !isConnected ? 'Desconectado' : 'Inativo'}
                      </span>
                      <span className="font-medium" style={{ color: 'var(--text-3)' }}>
                        <Clock className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                        {formatLastActive(chipStats?.lastActiveAt)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ═══ MODAL DETALHE DO CHIP ══════════════════════════════════════════ */}
        {selectedChipId && (() => {
          const channel = channels.find((c) => c.connectionId === selectedChipId);
          const conn = connections.find((c) => c.id === selectedChipId);
          const chipStats = warmupChipStats[selectedChipId];
          const maturity = computeMaturity(chipStats);
          const today = getTodayCounts(chipStats);
          const last30 = getLastNDays(chipStats, 30);
          const last7 = last30.slice(-7);
          const weeklyTotal = last7.reduce((a, b) => a + b.sent + b.received, 0);
          const avgDaily = chipStats && maturity.days > 0 ? Math.round((chipStats.totalSent + chipStats.totalReceived) / Math.max(1, maturity.days)) : 0;
          const maxDay = Math.max(1, ...last30.map((d) => d.sent + d.received));
          const failureRate = chipStats && chipStats.totalSent + chipStats.totalFailed > 0
            ? Math.round((chipStats.totalFailed / (chipStats.totalSent + chipStats.totalFailed)) * 100) : 0;
          const healthOk = failureRate < 10 && maturity.days > 0;
          const score = deriveChipScore(chipStats);

          return (
            <Modal isOpen onClose={() => setSelectedChipId(null)} title="" size="lg">
              <div className="space-y-5">
                {/* Header com gradiente */}
                <div
                  className="flex items-center gap-4 p-4 rounded-2xl"
                  style={{ background: maturity.gradient, border: `1px solid ${maturity.color}30` }}
                >
                  <div className="relative">
                    <div className="w-16 h-16 rounded-2xl overflow-hidden" style={{ border: `3px solid ${maturity.color}` }}>
                      {conn?.profilePicUrl
                        ? <img src={conn.profilePicUrl} className="w-full h-full object-cover" alt="" />
                        : <img src={`https://ui-avatars.com/api/?name=${encodeURIComponent(channel?.name || 'WA')}&background=${maturity.color.replace('#', '')}&color=fff&size=128&bold=true`} className="w-full h-full object-cover" alt="" />
                      }
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-[13px]" style={{ background: 'var(--surface-0)', border: `1.5px solid ${maturity.color}` }}>
                      {maturity.icon}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-[17px] font-extrabold truncate" style={{ color: 'var(--text-1)' }}>{channel?.name || 'Chip'}</h3>
                      <Badge variant={healthOk ? 'success' : 'warning'}>
                        {healthOk ? <><CheckCircle2 className="w-3 h-3" /> Saudável</> : <><AlertCircle className="w-3 h-3" /> Atenção</>}
                      </Badge>
                    </div>
                    <p className="text-[11.5px] font-mono" style={{ color: 'var(--text-3)' }}>{channel?.phoneNumber || 'Sem número'}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px]">
                      <span className="font-extrabold flex items-center gap-1" style={{ color: maturity.color }}>
                        <Flame className="w-3 h-3" /> {maturity.label}
                      </span>
                      <span style={{ color: 'var(--text-3)' }}>·</span>
                      <span className="font-semibold" style={{ color: 'var(--text-2)' }}>
                        <CalendarDays className="w-3 h-3 inline -mt-0.5 mr-0.5" />{maturity.days} dias aquecendo
                      </span>
                      <span style={{ color: 'var(--text-3)' }}>·</span>
                      <span className="font-semibold" style={{ color: 'var(--text-2)' }}>
                        Score <span style={{ color: getScoreColor(score) }}>{score}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Jornada de maturidade */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-[12px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-2)' }}>Jornada de aquecimento</h4>
                    <span className="text-[11px] font-bold" style={{ color: maturity.color }}>
                      {maturity.tier === 'premium' ? '👑 Nível máximo!' : `${Math.round(maturity.progress)}% para ${TIERS[TIERS.indexOf(maturity.tier) + 1]}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-1.5">
                    {TIERS.map((tier, idx) => {
                      const reached = TIERS.indexOf(maturity.tier) >= idx;
                      const current = maturity.tier === tier;
                      const c = TIER_COLORS[tier];
                      return (
                        <React.Fragment key={tier}>
                          <div className="flex flex-col items-center gap-1">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-[14px] transition-all"
                              style={{
                                background: reached ? `${c}20` : 'var(--surface-2)',
                                border: current ? `2px solid ${c}` : reached ? `1.5px solid ${c}60` : '1.5px solid var(--border-subtle)',
                                boxShadow: current ? `0 0 10px ${c}40` : 'none',
                              }}
                            >
                              {reached ? ['🌱','🔥','⚡','👑'][idx] : '○'}
                            </div>
                            <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: reached ? c : 'var(--text-3)' }}>
                              {tier}
                            </span>
                          </div>
                          {idx < TIERS.length - 1 && (
                            <div
                              className="flex-1 h-1 rounded-full mt-[-14px]"
                              style={{ background: TIERS.indexOf(maturity.tier) > idx ? `linear-gradient(90deg, ${TIER_COLORS[TIERS[idx]]}, ${TIER_COLORS[TIERS[idx + 1]]})` : 'var(--surface-2)' }}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>

                {/* KPIs principais */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { label: 'Enviadas', val: chipStats?.totalSent || 0, color: '#10b981' },
                    { label: 'Recebidas', val: chipStats?.totalReceived || 0, color: '#3b82f6' },
                    { label: 'Falhas', val: chipStats?.totalFailed || 0, color: '#ef4444' },
                    { label: 'Média/dia', val: avgDaily, color: 'var(--text-1)' },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="p-3 rounded-xl text-center" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                      <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>{label}</div>
                      <div className="text-[22px] font-extrabold tabular-nums" style={{ color }}>{val}</div>
                    </div>
                  ))}
                </div>

                {/* Taxa de falha + meta diária */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>Taxa de falha</div>
                    <div className="flex items-end gap-2">
                      <span className="text-[24px] font-extrabold tabular-nums" style={{ color: failureRate < 5 ? '#10b981' : failureRate < 15 ? '#f59e0b' : '#ef4444' }}>{failureRate}%</span>
                      <span className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-3)' }}>{failureRate < 5 ? 'Ótimo' : failureRate < 15 ? 'Aceitável' : 'Alto'}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ background: 'var(--surface-2)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, failureRate)}%`, background: failureRate < 5 ? '#10b981' : failureRate < 15 ? '#f59e0b' : '#ef4444' }} />
                    </div>
                  </div>
                  <div className="p-3 rounded-xl" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>Meta diária</div>
                    <div className="flex items-end gap-2">
                      <span className="text-[24px] font-extrabold tabular-nums" style={{ color: maturity.color }}>{today.sent + today.received}</span>
                      <span className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-3)' }}>/ {maturity.dailyTarget}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ background: 'var(--surface-2)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round(((today.sent + today.received) / maturity.dailyTarget) * 100))}%`, background: maturity.color }} />
                    </div>
                  </div>
                </div>

                {/* Gráfico 30 dias */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-[13px] font-bold flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
                      <BarChart3 className="w-4 h-4" style={{ color: maturity.color }} />
                      Histórico 30 dias
                    </h4>
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--text-3)' }}>
                      Semana: <span style={{ color: maturity.color }}>{weeklyTotal}</span> msgs
                    </span>
                  </div>
                  <div className="p-3 rounded-xl" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                    <div className="flex items-end gap-0.5" style={{ height: 100 }}>
                      {last30.map((d, i) => {
                        const total = d.sent + d.received;
                        const pct = (total / maxDay) * 100;
                        const isToday = d.date === brazilDayKey();
                        return (
                          <div key={d.date} className="flex-1 flex flex-col items-center group relative">
                            <div
                              className="w-full rounded-t transition-all duration-300"
                              style={{ height: `${Math.max(2, pct)}%`, background: isToday ? `linear-gradient(180deg, ${maturity.color}, ${maturity.color}cc)` : total > 0 ? `${maturity.color}50` : 'var(--surface-2)' }}
                            >
                              <div className="opacity-0 group-hover:opacity-100 pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap z-20" style={{ background: 'var(--text-1)', color: 'var(--surface-0)' }}>
                                {new Date(d.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}: {total}
                              </div>
                            </div>
                            {i % 7 === 0 && <span className="text-[8px] font-bold mt-0.5" style={{ color: 'var(--text-3)' }}>{new Date(d.date).getDate()}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Recomendação */}
                <div className="p-3.5 rounded-xl" style={{ background: maturity.bg, border: `1px solid ${maturity.color}30` }}>
                  <div className="flex items-start gap-2">
                    <TrendingUp className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: maturity.color }} />
                    <div className="text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                      <strong style={{ color: maturity.color }}>Recomendação para este chip:</strong>{' '}
                      {maturity.tier === 'novato' && 'Volume baixo (até 20 msg/dia). Evite disparos — aguarde 3 dias de aquecimento.'}
                      {maturity.tier === 'morno' && 'Pode iniciar disparos leves (até 50 msg/dia). Continue aquecendo para subir de nível.'}
                      {maturity.tier === 'quente' && 'Chip em boa forma — disparos médios (até 120 msg/dia). Em breve atinge Premium.'}
                      {maturity.tier === 'premium' && 'Chip premium! Volume alto (até 250 msg/dia) com baixo risco de bloqueio.'}
                    </div>
                  </div>
                </div>

                {/* Ações */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <Button variant="ghost" size="sm" leftIcon={<Trash2 className="w-4 h-4" />} onClick={() => setConfirmClearId(selectedChipId)}>
                    Zerar histórico
                  </Button>
                  <Button variant="secondary" size="sm" leftIcon={<X className="w-4 h-4" />} onClick={() => setSelectedChipId(null)}>
                    Fechar
                  </Button>
                </div>
              </div>
            </Modal>
          );
        })()}

        {/* ═══ MODAL CONFIRMAÇÃO ZERAR ════════════════════════════════════════ */}
        <Modal
          isOpen={!!confirmClearId}
          onClose={() => setConfirmClearId(null)}
          title="Zerar histórico de aquecimento"
          icon={<AlertTriangle className="w-5 h-5" style={{ color: '#f59e0b' }} />}
        >
          <div className="space-y-4">
            <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
              Apaga permanentemente o histórico de aquecimento deste chip (dias, mensagens, curva 30 dias).
              O chip voltará ao nível <strong>Novato</strong>.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirmClearId(null)}>Cancelar</Button>
              <Button
                variant="danger" size="sm"
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
    </PageShell>
  );
};
