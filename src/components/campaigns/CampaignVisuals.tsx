import React, { useMemo } from 'react';

// ──────────────────────────────────────────────────────────────────────────────
// Sparkline (linha fina)
// ──────────────────────────────────────────────────────────────────────────────
export const Sparkline: React.FC<{
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  showDot?: boolean;
  className?: string;
}> = ({
  values,
  width = 120,
  height = 36,
  stroke = 'var(--brand-500)',
  fill,
  showDot = true,
  className
}) => {
  const { path, areaPath, lastX, lastY } = useMemo(() => {
    if (!values.length) return { path: '', areaPath: '', lastX: 0, lastY: 0 };
    const max = Math.max(1, ...values);
    const min = Math.min(...values);
    const range = Math.max(1, max - min);
    const stepX = values.length > 1 ? width / (values.length - 1) : width;
    const pts = values.map((v, i) => {
      const x = i * stepX;
      const y = height - 4 - ((v - min) / range) * (height - 8);
      return { x, y };
    });
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    const a = `${d} L${pts[pts.length - 1].x.toFixed(2)},${height} L0,${height} Z`;
    return { path: d, areaPath: a, lastX: pts[pts.length - 1].x, lastY: pts[pts.length - 1].y };
  }, [values, width, height]);

  if (!values.length) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {fill && <path d={areaPath} fill={fill} />}
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      {showDot && (
        <>
          <circle cx={lastX} cy={lastY} r={3} fill={stroke} />
          <circle cx={lastX} cy={lastY} r={6} fill={stroke} opacity={0.25}>
            <animate attributeName="r" values="3;7;3" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.35;0;0.35" dur="1.6s" repeatCount="indefinite" />
          </circle>
        </>
      )}
    </svg>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Pulse Chart — área suave 24h
// ──────────────────────────────────────────────────────────────────────────────
export const PulseChart: React.FC<{
  values: number[];
  height?: number;
  color?: string;
  labels?: string[];
}> = ({ values, height = 120, color = 'var(--brand-500)', labels }) => {
  const { linePath, areaPath, points, max } = useMemo(() => {
    const width = 100;
    if (!values.length)
      return { linePath: '', areaPath: '', points: [] as { x: number; y: number; v: number }[], max: 0 };
    const max = Math.max(1, ...values);
    const stepX = values.length > 1 ? width / (values.length - 1) : width;
    const pts = values.map((v, i) => {
      const x = i * stepX;
      const y = 100 - (v / max) * 100;
      return { x, y, v };
    });
    // Suavização cúbica simples
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const cpx = (p0.x + p1.x) / 2;
      d += ` C${cpx},${p0.y} ${cpx},${p1.y} ${p1.x},${p1.y}`;
    }
    const a = `${d} L${pts[pts.length - 1].x},100 L0,100 Z`;
    return { linePath: d, areaPath: a, points: pts, max };
  }, [values]);

  if (!values.length) {
    return (
      <div
        className="w-full rounded-xl flex items-center justify-center text-[11.5px]"
        style={{
          height,
          background: 'var(--surface-1)',
          color: 'var(--text-3)',
          border: '1px dashed var(--border-subtle)'
        }}
      >
        Sem dados de pulso ainda
      </div>
    );
  }

  const gradientId = useMemo(() => `pulse-grad-${Math.random().toString(36).slice(2, 10)}`, []);

  return (
    <div className="relative w-full" style={{ height }}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="w-full h-full"
        style={{ overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[25, 50, 75].map((y) => (
          <line
            key={y}
            x1={0}
            x2={100}
            y1={y}
            y2={y}
            stroke="var(--border-subtle)"
            strokeWidth={0.2}
            strokeDasharray="0.6 0.6"
          />
        ))}
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={0.9}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {points.length > 0 && (
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r={1.2}
            fill={color}
            stroke="#fff"
            strokeWidth={0.4}
          />
        )}
      </svg>
      {labels && labels.length > 0 && (
        <div className="absolute left-0 right-0 bottom-0 flex justify-between px-0.5 text-[9px] font-semibold pointer-events-none" style={{ color: 'var(--text-3)' }}>
          {labels.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
      )}
      <div
        className="absolute top-1 right-1 text-[9px] font-bold tabular-nums px-1.5 py-0.5 rounded"
        style={{ background: 'var(--surface-0)', color: 'var(--text-3)', border: '1px solid var(--border-subtle)' }}
      >
        pico {max.toLocaleString('pt-BR')}
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Heatmap Calendar (estilo GitHub)
// ──────────────────────────────────────────────────────────────────────────────
export const HeatmapCalendar: React.FC<{
  /** mapa ISO date (YYYY-MM-DD) → valor */
  data: Record<string, number>;
  days?: number;
  color?: string;
}> = ({ data, days = 90, color = '#10b981' }) => {
  const grid = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - days + 1);
    // Voltar até domingo pra alinhar
    const startDow = start.getDay();
    start.setDate(start.getDate() - startDow);

    const cells: { key: string; value: number; date: Date; inRange: boolean }[] = [];
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const from = new Date(now);
    from.setDate(from.getDate() - days + 1);
    const fromKey = new Date(from.getFullYear(), from.getMonth(), from.getDate());

    const d = new Date(start);
    while (d <= today) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      cells.push({
        key,
        value: data[key] || 0,
        date: new Date(d),
        inRange: d >= fromKey && d <= today
      });
      d.setDate(d.getDate() + 1);
    }
    // Organizar em colunas por semana (cada coluna = 7 dias)
    const cols: typeof cells[] = [];
    for (let i = 0; i < cells.length; i += 7) {
      cols.push(cells.slice(i, i + 7));
    }
    const max = Math.max(1, ...cells.map((c) => c.value));
    return { cols, max };
  }, [data, days]);

  const levelFor = (v: number) => {
    if (v === 0) return 0;
    const r = v / grid.max;
    if (r < 0.25) return 1;
    if (r < 0.5) return 2;
    if (r < 0.75) return 3;
    return 4;
  };

  const levelBg = (lvl: number) => {
    if (lvl === 0) return 'var(--surface-1)';
    if (lvl === 1) return `color-mix(in srgb, ${color} 22%, transparent)`;
    if (lvl === 2) return `color-mix(in srgb, ${color} 45%, transparent)`;
    if (lvl === 3) return `color-mix(in srgb, ${color} 70%, transparent)`;
    return color;
  };

  const dowLabels = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const monthLabel = (date: Date) =>
    date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');

  // Labels de mês: uma por coluna que inicia em novo mês (dia 1-7)
  const monthCols = grid.cols.map((col, i) => {
    if (!col[0]) return null;
    const prev = i > 0 ? grid.cols[i - 1][0] : null;
    if (!prev || prev.date.getMonth() !== col[0].date.getMonth()) {
      return monthLabel(col[0].date);
    }
    return null;
  });

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1 min-w-fit">
        <div className="flex flex-col gap-[3px] pt-[18px] pr-1">
          {dowLabels.map((l, i) => (
            <span
              key={`${l}-${i}`}
              className="text-[8.5px] h-[11px] leading-[11px]"
              style={{ color: 'var(--text-3)', opacity: i % 2 === 0 ? 1 : 0 }}
            >
              {l}
            </span>
          ))}
        </div>
        <div>
          <div className="flex gap-[3px] h-4 mb-1">
            {monthCols.map((m, i) => (
              <span
                key={i}
                className="text-[9px] font-semibold w-[11px] whitespace-nowrap"
                style={{ color: 'var(--text-3)', opacity: m ? 1 : 0 }}
              >
                {m || '·'}
              </span>
            ))}
          </div>
          <div className="flex gap-[3px]">
            {grid.cols.map((col, ci) => (
              <div key={ci} className="flex flex-col gap-[3px]">
                {Array.from({ length: 7 }).map((_, di) => {
                  const cell = col[di];
                  if (!cell) return <div key={di} className="w-[11px] h-[11px]" />;
                  const lvl = levelFor(cell.value);
                  return (
                    <div
                      key={di}
                      title={
                        cell.inRange
                          ? `${cell.date.toLocaleDateString('pt-BR')} — ${cell.value} campanha${cell.value === 1 ? '' : 's'}`
                          : ''
                      }
                      className="w-[11px] h-[11px] rounded-[2.5px] transition-transform hover:scale-125 cursor-help"
                      style={{
                        background: cell.inRange ? levelBg(lvl) : 'transparent',
                        border: cell.inRange ? '1px solid var(--border-subtle)' : 'none',
                        opacity: cell.inRange ? 1 : 0
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-3 text-[10px]" style={{ color: 'var(--text-3)' }}>
        <span>Menos</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <div
            key={l}
            className="w-[11px] h-[11px] rounded-[2.5px]"
            style={{ background: levelBg(l), border: '1px solid var(--border-subtle)' }}
          />
        ))}
        <span>Mais</span>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// MiniBar Row (linhas de barras pequenas)
// ──────────────────────────────────────────────────────────────────────────────
export const MiniBarRow: React.FC<{
  label: string;
  value: number;
  max: number;
  color?: string;
  helper?: string;
}> = ({ label, value, max, color = 'var(--brand-500)', helper }) => {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <span className="text-[12.5px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
            {label}
          </span>
          <span className="text-[10.5px] tabular-nums font-bold" style={{ color: 'var(--text-3)' }}>
            {value.toLocaleString('pt-BR')}
            {helper ? ` · ${helper}` : ''}
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${color}, ${color}aa)`
            }}
          />
        </div>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers compartilhados
// ──────────────────────────────────────────────────────────────────────────────
export const fmtInt = (n: number) => n.toLocaleString('pt-BR');
export const fmtPct = (n: number, d = 0) => `${n.toFixed(d)}%`;
