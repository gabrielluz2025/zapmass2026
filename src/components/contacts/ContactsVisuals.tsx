import React, { useMemo } from 'react';

/** Donut (Pizza) SVG leve com segmentos proporcionais. */
export interface DonutSlice {
  id: string;
  label: string;
  value: number;
  color: string; // hex or CSS var-friendly
}

interface DonutChartProps {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerTop?: string;
  centerBottom?: string;
}

export const DonutChart: React.FC<DonutChartProps> = ({
  slices,
  size = 160,
  thickness = 22,
  centerTop,
  centerBottom
}) => {
  const total = slices.reduce((a, s) => a + Math.max(0, s.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;

  let acc = 0;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        {/* trilha de fundo */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(148, 163, 184, 0.18)"
          strokeWidth={thickness}
        />
        {total > 0 &&
          slices.map((s) => {
            if (s.value <= 0) return null;
            const frac = s.value / total;
            const len = c * frac;
            const offset = c * (acc / total);
            acc += s.value;
            return (
              <circle
                key={s.id}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        {centerTop && <p className="text-2xl font-black text-slate-900 dark:text-white tabular-nums leading-none">{centerTop}</p>}
        {centerBottom && <p className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider mt-1">{centerBottom}</p>}
      </div>
    </div>
  );
};

/** Legenda horizontal para o Donut. */
export const DonutLegend: React.FC<{ slices: DonutSlice[]; total?: number }> = ({ slices, total }) => {
  const sum = total ?? slices.reduce((a, s) => a + s.value, 0);
  return (
    <div className="space-y-1.5 w-full">
      {slices.map((s) => {
        const pct = sum > 0 ? Math.round((s.value / sum) * 100) : 0;
        return (
          <div key={s.id} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="flex-1 text-slate-600 dark:text-slate-300 truncate">{s.label}</span>
            <span className="font-bold tabular-nums text-slate-900 dark:text-white">{s.value}</span>
            <span className="font-semibold tabular-nums text-slate-400 w-9 text-right">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
};

/** Barra horizontal rankeada — ótima para top cidades/igrejas. */
export interface BarListItem {
  id: string;
  label: string;
  value: number;
  sublabel?: string;
  accent?: string; // CSS color
}

export const BarList: React.FC<{
  items: BarListItem[];
  max?: number;
  emptyLabel?: string;
  valueFormatter?: (n: number) => string;
}> = ({ items, max, emptyLabel = 'Sem dados', valueFormatter }) => {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) {
    return <p className="text-[12px] text-slate-400 py-4 text-center">{emptyLabel}</p>;
  }
  return (
    <div className="space-y-2">
      {items.map((it) => {
        const pct = Math.max(2, Math.round((it.value / top) * 100));
        const accent = it.accent || 'linear-gradient(90deg, rgba(16,185,129,.85), rgba(16,185,129,.55))';
        return (
          <div key={it.id} className="group">
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-[12px] font-semibold text-slate-800 dark:text-slate-200 truncate">{it.label}</span>
              <span className="text-[11px] tabular-nums font-bold text-slate-600 dark:text-slate-300 shrink-0">
                {valueFormatter ? valueFormatter(it.value) : it.value.toLocaleString()}
                {it.sublabel && <span className="ml-1 text-[10px] font-normal text-slate-400">{it.sublabel}</span>}
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 group-hover:brightness-110"
                style={{ width: `${pct}%`, background: accent }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Heatmap estilo GitHub — matriz semanas x dia para últimos N dias. */
interface MiniHeatmapProps {
  /** Array com N dias do passado, cada item = count. O item final é HOJE. */
  days: number[];
  weeks?: number; // colunas
  cellSize?: number;
  gap?: number;
  colorSteps?: string[];
}

export const MiniHeatmap: React.FC<MiniHeatmapProps> = ({
  days,
  weeks = 13,
  cellSize = 11,
  gap = 3,
  colorSteps = ['rgba(148,163,184,0.15)', 'rgba(52,211,153,0.35)', 'rgba(52,211,153,0.6)', 'rgba(16,185,129,0.85)', 'rgba(5,150,105,1)']
}) => {
  const needed = weeks * 7;
  const padded = days.length >= needed ? days.slice(days.length - needed) : [...Array(needed - days.length).fill(0), ...days];
  const max = Math.max(1, ...padded);

  const color = (v: number) => {
    if (v <= 0) return colorSteps[0];
    const ratio = v / max;
    const idx = Math.min(colorSteps.length - 1, Math.ceil(ratio * (colorSteps.length - 1)));
    return colorSteps[idx];
  };

  const width = weeks * (cellSize + gap);
  const height = 7 * (cellSize + gap);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      {padded.map((v, i) => {
        const col = Math.floor(i / 7);
        const row = i % 7;
        return (
          <rect
            key={i}
            x={col * (cellSize + gap)}
            y={row * (cellSize + gap)}
            width={cellSize}
            height={cellSize}
            rx={2}
            fill={color(v)}
          >
            <title>{`${v} contato(s) • há ${padded.length - 1 - i} dias`}</title>
          </rect>
        );
      })}
    </svg>
  );
};

/** Sparkline super compacta. */
export const Sparkline: React.FC<{
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: string;
}> = ({ values, width = 100, height = 28, color = '#10b981', fill = 'rgba(16,185,129,0.15)' }) => {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x},${y}`;
  });
  const path = `M ${points.join(' L ')}`;
  const area = `M 0,${height} L ${points.join(' L ')} L ${width},${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block overflow-visible">
      <path d={area} fill={fill} stroke="none" />
      <path d={path} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

/** Calcula série de N últimos dias de criação a partir dos IDs (ts embutido). */
export function useDailyGrowth(contacts: { id: string }[], days: number): number[] {
  return useMemo(() => {
    const buckets = new Array(days).fill(0);
    const now = Date.now();
    const DAY = 86400000;
    for (const c of contacts) {
      const m = (c.id || '').match(/_(\d{13})_/);
      const ts = m ? parseInt(m[1], 10) : null;
      if (!ts || !Number.isFinite(ts)) continue;
      const age = Math.floor((now - ts) / DAY);
      if (age < 0 || age >= days) continue;
      buckets[days - 1 - age]++;
    }
    return buckets;
  }, [contacts, days]);
}

/** Mini pílula de KPI com sparkline embutida. */
export const KpiPill: React.FC<{
  label: string;
  value: string | number;
  hint?: string;
  accent?: 'emerald' | 'amber' | 'rose' | 'sky' | 'violet' | 'slate';
  spark?: number[];
  icon?: React.ReactNode;
}> = ({ label, value, hint, accent = 'emerald', spark, icon }) => {
  const accentMap: Record<string, { bg: string; fg: string; ring: string; spark: string; sparkFill: string }> = {
    emerald: { bg: 'from-emerald-500/15 to-emerald-500/5', fg: 'text-emerald-600 dark:text-emerald-400', ring: 'ring-emerald-200/60 dark:ring-emerald-900/40', spark: '#10b981', sparkFill: 'rgba(16,185,129,0.18)' },
    amber:   { bg: 'from-amber-500/15 to-amber-500/5',     fg: 'text-amber-600 dark:text-amber-400',     ring: 'ring-amber-200/60 dark:ring-amber-900/40',     spark: '#f59e0b', sparkFill: 'rgba(245,158,11,0.18)' },
    rose:    { bg: 'from-rose-500/15 to-rose-500/5',       fg: 'text-rose-600 dark:text-rose-400',       ring: 'ring-rose-200/60 dark:ring-rose-900/40',       spark: '#f43f5e', sparkFill: 'rgba(244,63,94,0.18)' },
    sky:     { bg: 'from-sky-500/15 to-sky-500/5',         fg: 'text-sky-600 dark:text-sky-400',         ring: 'ring-sky-200/60 dark:ring-sky-900/40',         spark: '#0ea5e9', sparkFill: 'rgba(14,165,233,0.18)' },
    violet:  { bg: 'from-violet-500/15 to-violet-500/5',   fg: 'text-violet-600 dark:text-violet-400',   ring: 'ring-violet-200/60 dark:ring-violet-900/40',   spark: '#8b5cf6', sparkFill: 'rgba(139,92,246,0.18)' },
    slate:   { bg: 'from-slate-500/15 to-slate-500/5',     fg: 'text-slate-600 dark:text-slate-300',     ring: 'ring-slate-200/60 dark:ring-slate-700/60',     spark: '#64748b', sparkFill: 'rgba(100,116,139,0.18)' }
  };
  const a = accentMap[accent];
  return (
    <div className={`relative overflow-hidden rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-gradient-to-br ${a.bg} ring-1 ${a.ring} p-3`}>
      <div className="flex items-start justify-between gap-2 relative z-10">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</p>
          <p className="text-2xl font-black tabular-nums text-slate-900 dark:text-white leading-none mt-1">
            {value}
          </p>
          {hint && <p className={`text-[11px] font-semibold mt-1 ${a.fg}`}>{hint}</p>}
        </div>
        {icon && <div className={`p-1.5 rounded-lg bg-white/60 dark:bg-slate-900/40 ${a.fg}`}>{icon}</div>}
      </div>
      {spark && spark.length > 1 && (
        <div className="absolute bottom-0 left-0 right-0 opacity-70 pointer-events-none">
          <Sparkline values={spark} width={260} height={32} color={a.spark} fill={a.sparkFill} />
        </div>
      )}
    </div>
  );
};
