import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCheck,
  Eye,
  Reply,
  Send,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp
} from 'lucide-react';

export interface FunnelStageInput {
  label: string;
  value: number;
  color: string;
  icon: React.ReactNode;
}

export interface PerformanceFunnelProps {
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  /** Tamanho do funil (altura do SVG em px). Default: 360. */
  height?: number;
  /** Exibe painel lateral com KPI + insight de maior perda. */
  showSidePanel?: boolean;
  /** Título sobre o painel lateral. */
  compact?: boolean;
}

// Benchmarks de mercado (taxa replies/sent em campanhas de WhatsApp transacionais)
const BENCHMARK_REPLY_LOW = 3;
const BENCHMARK_REPLY_OK = 8;
const BENCHMARK_REPLY_GREAT = 15;

const fmt = (n: number) => n.toLocaleString('pt-BR');

export const PerformanceFunnel: React.FC<PerformanceFunnelProps> = ({
  sent,
  delivered,
  read,
  replied,
  height = 360,
  showSidePanel = true,
  compact = false
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const stages: FunnelStageInput[] = useMemo(
    () => [
      { label: 'Enviadas', value: sent, color: '#10b981', icon: <Send className="w-3.5 h-3.5" /> },
      { label: 'Entregues', value: delivered, color: '#3b82f6', icon: <CheckCheck className="w-3.5 h-3.5" /> },
      { label: 'Lidas', value: read, color: '#8b5cf6', icon: <Eye className="w-3.5 h-3.5" /> },
      { label: 'Respostas', value: replied, color: '#f59e0b', icon: <Reply className="w-3.5 h-3.5" /> }
    ],
    [sent, delivered, read, replied]
  );

  const total = Math.max(sent, delivered, read, replied);
  const isEmpty = total === 0;

  // Calcula os dois "ombros" de cada segmento trapezoidal, em % da largura total
  const segments = useMemo(() => {
    if (isEmpty) return [];
    const maxVal = Math.max(1, stages[0].value);
    return stages.map((s, i) => {
      const wTop = Math.max(6, Math.round((s.value / maxVal) * 100));
      const wBot = i < stages.length - 1
        ? Math.max(4, Math.round((stages[i + 1].value / maxVal) * 100))
        : Math.max(4, Math.round(wTop * 0.55));
      const conversionNext = i < stages.length - 1
        ? (s.value > 0 ? Math.round((stages[i + 1].value / s.value) * 100) : 0)
        : null;
      const dropNext = i < stages.length - 1
        ? Math.max(0, s.value - stages[i + 1].value)
        : 0;
      return { ...s, wTop, wBot, conversionNext, dropNext };
    });
  }, [stages, isEmpty]);

  // Taxa final (replies / sent)
  const conversionRate = sent > 0 ? (replied / sent) * 100 : 0;
  const conversionRateRounded = Math.round(conversionRate * 10) / 10;

  const benchmarkStatus = useMemo(() => {
    if (conversionRate >= BENCHMARK_REPLY_GREAT)
      return { label: 'Excelente', color: '#10b981', icon: <Sparkles className="w-3.5 h-3.5" />, note: 'Acima da média do mercado' };
    if (conversionRate >= BENCHMARK_REPLY_OK)
      return { label: 'Bom', color: '#3b82f6', icon: <TrendingUp className="w-3.5 h-3.5" />, note: 'Na faixa de mercado (8–15%)' };
    if (conversionRate >= BENCHMARK_REPLY_LOW)
      return { label: 'Na média', color: '#f59e0b', icon: <Activity className="w-3.5 h-3.5" />, note: 'Tem espaço pra crescer' };
    return { label: 'Abaixo', color: '#ef4444', icon: <TrendingDown className="w-3.5 h-3.5" />, note: 'Revise texto e horário' };
  }, [conversionRate]);

  // Identifica o maior "vazamento" (queda absoluta entre etapas)
  const biggestLeak = useMemo(() => {
    if (isEmpty || segments.length < 2) return null;
    let worst = { idx: -1, drop: 0, dropPct: 0, from: '', to: '' };
    for (let i = 0; i < segments.length - 1; i++) {
      const a = segments[i];
      const b = segments[i + 1];
      if (a.value <= 0) continue;
      const dropPct = 100 - (a.conversionNext ?? 0);
      if (a.dropNext > worst.drop) {
        worst = { idx: i, drop: a.dropNext, dropPct, from: a.label, to: b.label };
      }
    }
    if (worst.idx < 0) return null;

    const tips: Record<string, string> = {
      'Enviadas→Entregues': 'Números inválidos ou chip bloqueado. Rode a validação da lista antes do próximo disparo.',
      'Entregues→Lidas': 'A primeira frase não engaja. Teste abrir com o nome do cliente e uma pergunta curta.',
      'Lidas→Respostas': 'Falta um convite claro pra ação. Termine a mensagem com uma pergunta direta ou um botão.'
    };
    const key = `${worst.from}→${worst.to}`;
    return { ...worst, tip: tips[key] || 'Analise a etapa e teste uma variação de texto.' };
  }, [segments, isEmpty]);

  if (isEmpty) {
    return (
      <div
        className="rounded-2xl px-4 py-12 text-center relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, var(--surface-1) 0%, var(--surface-2) 100%)',
          border: '1px dashed var(--border-subtle)'
        }}
      >
        <div
          className="relative mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
          style={{
            background: 'linear-gradient(135deg, rgba(16,185,129,0.18), rgba(59,130,246,0.14))',
            border: '1px solid rgba(16,185,129,0.22)'
          }}
        >
          <Target className="w-7 h-7" style={{ color: 'var(--brand-600)' }} />
        </div>
        <p className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>
          A jornada começa no primeiro envio
        </p>
        <p className="text-[12px] mt-1.5 max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--text-3)' }}>
          Assim que suas campanhas começarem a rodar, você vai ver aqui o caminho completo —
          <strong style={{ color: 'var(--text-2)' }}> de enviado até a resposta</strong> — em tempo real.
        </p>
      </div>
    );
  }

  return (
    <div className={`flex ${compact ? 'flex-col' : 'flex-col lg:flex-row'} gap-5 lg:gap-6`}>
      {/* FUNIL SVG */}
      <div className="flex-1 min-w-0">
        <FunnelSvg segments={segments} height={height} hoverIdx={hoverIdx} onHover={setHoverIdx} />
      </div>

      {/* PAINEL LATERAL */}
      {showSidePanel && (
        <div className={`${compact ? 'w-full' : 'lg:w-[300px]'} shrink-0 flex flex-col gap-3`}>
          {/* KPI — taxa de conversão global */}
          <div
            className="rounded-2xl p-4 relative overflow-hidden"
            style={{
              background: `linear-gradient(165deg, ${benchmarkStatus.color}14 0%, ${benchmarkStatus.color}05 100%)`,
              border: `1px solid ${benchmarkStatus.color}33`
            }}
          >
            <div
              className="absolute -top-12 -right-12 w-36 h-36 rounded-full pointer-events-none opacity-[0.2]"
              style={{ background: `radial-gradient(circle, ${benchmarkStatus.color}, transparent 70%)` }}
              aria-hidden
            />
            <div className="relative flex items-center justify-between mb-1">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>
                Taxa de conversão
              </p>
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-widest"
                style={{
                  background: `${benchmarkStatus.color}22`,
                  color: benchmarkStatus.color,
                  border: `1px solid ${benchmarkStatus.color}44`
                }}
              >
                {benchmarkStatus.icon}
                {benchmarkStatus.label}
              </span>
            </div>
            <div className="relative flex items-baseline gap-1.5">
              <span className="text-[40px] font-extrabold tabular-nums leading-none" style={{ color: 'var(--text-1)' }}>
                {conversionRateRounded.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
              </span>
              <span className="text-[20px] font-bold" style={{ color: benchmarkStatus.color }}>%</span>
            </div>
            <p className="relative text-[11.5px] mt-1" style={{ color: 'var(--text-3)' }}>
              <strong style={{ color: 'var(--text-2)' }}>{fmt(replied)}</strong> respostas de{' '}
              <strong style={{ color: 'var(--text-2)' }}>{fmt(sent)}</strong> envios
            </p>

            {/* Benchmark range visual */}
            <div className="relative mt-3">
              <div className="h-1.5 rounded-full relative overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${Math.min(100, (conversionRate / 20) * 100)}%`,
                    background: `linear-gradient(90deg, ${benchmarkStatus.color}, ${benchmarkStatus.color}99)`,
                    boxShadow: `0 0 8px ${benchmarkStatus.color}66`
                  }}
                />
                {/* Marcadores de benchmark */}
                <BenchmarkMark pos={BENCHMARK_REPLY_LOW / 20} />
                <BenchmarkMark pos={BENCHMARK_REPLY_OK / 20} />
                <BenchmarkMark pos={BENCHMARK_REPLY_GREAT / 20} />
              </div>
              <div className="flex items-center justify-between mt-1 text-[9.5px] font-semibold" style={{ color: 'var(--text-3)' }}>
                <span>0%</span>
                <span className="tabular-nums">{BENCHMARK_REPLY_LOW}%</span>
                <span className="tabular-nums">{BENCHMARK_REPLY_OK}%</span>
                <span className="tabular-nums">{BENCHMARK_REPLY_GREAT}%</span>
                <span>20%</span>
              </div>
              <p className="relative text-[10.5px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
                {benchmarkStatus.note}
              </p>
            </div>
          </div>

          {/* MAIOR VAZAMENTO */}
          {biggestLeak && (
            <div
              className="rounded-2xl p-4 relative overflow-hidden"
              style={{
                background: 'linear-gradient(165deg, rgba(245,158,11,0.12) 0%, rgba(239,68,68,0.04) 100%)',
                border: '1px solid rgba(245,158,11,0.3)'
              }}
            >
              <div className="flex items-start gap-2.5 mb-2">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)' }}
                >
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.12em]" style={{ color: '#b45309' }}>
                    Maior oportunidade
                  </p>
                  <p className="text-[12.5px] font-bold mt-0.5 leading-tight" style={{ color: 'var(--text-1)' }}>
                    {biggestLeak.from} → {biggestLeak.to}
                  </p>
                </div>
                <span
                  className="text-[18px] font-extrabold tabular-nums leading-none"
                  style={{ color: '#ef4444' }}
                >
                  −{biggestLeak.dropPct}%
                </span>
              </div>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                <strong style={{ color: 'var(--text-1)' }}>{fmt(biggestLeak.drop)}</strong> {biggestLeak.drop === 1 ? 'pessoa' : 'pessoas'} não avançaram aqui.
              </p>
              <div
                className="mt-2.5 px-2.5 py-2 rounded-lg text-[11.5px] leading-relaxed flex items-start gap-1.5"
                style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)', color: 'var(--text-2)' }}
              >
                <Sparkles className="w-3 h-3 mt-0.5 shrink-0" style={{ color: 'var(--brand-600)' }} />
                <span>{biggestLeak.tip}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// -----------------------------------------------
// Sub: SVG trapezoidal com setas de conversão
// -----------------------------------------------

interface FunnelSvgProps {
  segments: Array<FunnelStageInput & { wTop: number; wBot: number; conversionNext: number | null; dropNext: number }>;
  height: number;
  hoverIdx: number | null;
  onHover: (idx: number | null) => void;
}

const FunnelSvg: React.FC<FunnelSvgProps> = ({ segments, height, hoverIdx, onHover }) => {
  const VW = 520; // viewBox width (percentual-friendly)
  const gap = 10; // px entre segmentos no SVG
  const segmentHeight = (height - gap * (segments.length - 1)) / segments.length;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${VW} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="xMidYMid meet"
        className="overflow-visible"
      >
        <defs>
          {segments.map((s, i) => (
            <linearGradient key={i} id={`funnel-grad-${i}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.95} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.55} />
            </linearGradient>
          ))}
          <filter id="funnel-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#000" floodOpacity="0.18" />
          </filter>
        </defs>

        {segments.map((s, i) => {
          const y = i * (segmentHeight + gap);
          const halfTop = (s.wTop / 100) * (VW / 2);
          const halfBot = (s.wBot / 100) * (VW / 2);
          const cx = VW / 2;
          const path = `
            M ${cx - halfTop} ${y}
            L ${cx + halfTop} ${y}
            L ${cx + halfBot} ${y + segmentHeight}
            L ${cx - halfBot} ${y + segmentHeight}
            Z
          `;
          const isDimmed = hoverIdx !== null && hoverIdx !== i;
          const isActive = hoverIdx === i;

          return (
            <g
              key={i}
              onMouseEnter={() => onHover(i)}
              onMouseLeave={() => onHover(null)}
              style={{ cursor: 'pointer', opacity: isDimmed ? 0.35 : 1, transition: 'opacity 200ms' }}
            >
              <path
                d={path}
                fill={`url(#funnel-grad-${i})`}
                filter="url(#funnel-shadow)"
                style={{
                  transition: 'transform 300ms cubic-bezier(0.2,0.7,0.2,1)',
                  transform: isActive ? `scale(1.03)` : 'scale(1)',
                  transformOrigin: `${cx}px ${y + segmentHeight / 2}px`
                }}
              />
              {/* Contorno sutil */}
              <path
                d={path}
                fill="none"
                stroke="rgba(255,255,255,0.15)"
                strokeWidth={1}
              />

              {/* Label central */}
              <foreignObject x={0} y={y} width={VW} height={segmentHeight} pointerEvents="none">
                <div
                  className="w-full h-full flex items-center justify-center gap-3 px-4"
                  style={{ color: '#fff' }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-7 h-7 rounded-lg flex items-center justify-center"
                      style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.28)' }}
                    >
                      {s.icon}
                    </span>
                    <span className="text-[12.5px] sm:text-[13.5px] font-bold drop-shadow-[0_1px_3px_rgba(0,0,0,0.45)]">
                      {s.label}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[18px] sm:text-[22px] font-extrabold tabular-nums leading-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]">
                      {fmt(s.value)}
                    </span>
                  </div>
                </div>
              </foreignObject>
            </g>
          );
        })}

        {/* Setas de conversão entre segmentos */}
        {segments.slice(0, -1).map((s, i) => {
          const y = (i + 1) * segmentHeight + i * gap + gap / 2;
          const cx = VW / 2;
          const isBad = (s.conversionNext ?? 0) < 30;
          const isGood = (s.conversionNext ?? 0) >= 70;
          const arrowColor = isGood ? '#10b981' : isBad ? '#ef4444' : '#f59e0b';
          return (
            <g key={`conv-${i}`}>
              {/* Pill central com a conversão */}
              <foreignObject x={cx - 50} y={y - 11} width={100} height={22} pointerEvents="none">
                <div
                  className="flex items-center justify-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold tabular-nums"
                  style={{
                    background: 'var(--surface-0)',
                    border: `1.5px solid ${arrowColor}`,
                    color: arrowColor,
                    boxShadow: `0 4px 10px -4px ${arrowColor}88`
                  }}
                >
                  {isGood ? '↓' : isBad ? '⚠' : '↓'} {s.conversionNext}%
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>

      {/* Tooltip ao passar o mouse */}
      {hoverIdx !== null && segments[hoverIdx] && (
        <FunnelHoverCard stage={segments[hoverIdx]} />
      )}
    </div>
  );
};

const FunnelHoverCard: React.FC<{
  stage: FunnelStageInput & { wTop: number; conversionNext: number | null; dropNext: number };
}> = ({ stage }) => (
  <div
    className="absolute top-2 right-2 rounded-xl px-3 py-2 text-[11.5px] z-20 pointer-events-none"
    style={{
      background: 'var(--surface-0)',
      border: `1.5px solid ${stage.color}`,
      boxShadow: `0 12px 30px -10px ${stage.color}55`,
      minWidth: 160
    }}
  >
    <div className="flex items-center gap-1.5 mb-1">
      <span style={{ color: stage.color }}>{stage.icon}</span>
      <span className="font-bold" style={{ color: 'var(--text-1)' }}>{stage.label}</span>
    </div>
    <div className="flex items-baseline gap-1.5">
      <span className="text-[16px] font-extrabold tabular-nums" style={{ color: stage.color }}>
        {fmt(stage.value)}
      </span>
      <span className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>
        ({stage.wTop}% do topo)
      </span>
    </div>
    {stage.conversionNext !== null && (
      <p className="text-[10.5px] mt-1 leading-snug" style={{ color: 'var(--text-3)' }}>
        <strong style={{ color: 'var(--text-2)' }}>{stage.conversionNext}%</strong> avançam ·{' '}
        <strong style={{ color: '#ef4444' }}>{fmt(stage.dropNext)}</strong> saem
      </p>
    )}
  </div>
);

const BenchmarkMark: React.FC<{ pos: number }> = ({ pos }) => (
  <div
    className="absolute inset-y-0"
    style={{
      left: `${pos * 100}%`,
      width: 2,
      background: 'var(--text-3)',
      opacity: 0.35
    }}
    aria-hidden
  />
);
