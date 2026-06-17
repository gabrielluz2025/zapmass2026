/**
 * Funil orbital — anéis concêntricos (visual distinto de barras/cards/steps).
 */
import React from 'react';

type Ring = {
  label: string;
  value: number;
  pct: number;
  color: string;
};

type Props = {
  rings: Ring[];
  centerLabel: string;
  centerValue: string;
  onClick?: () => void;
  size?: number;
};

function ringArc(r: number, pct: number, strokeWidth: number): { dash: string; circ: number } {
  const circ = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, pct)) / 100;
  const dash = `${circ * filled} ${circ * (1 - filled)}`;
  return { dash, circ };
}

export const FunnelOrbitVisual: React.FC<Props> = ({
  rings,
  centerLabel,
  centerValue,
  onClick,
  size = 220,
}) => {
  const cx = size / 2;
  const cy = size / 2;
  const stroke = 11;
  const gap = 14;
  const baseR = size / 2 - stroke - 4;

  return (
    <button
      type="button"
      onClick={onClick}
      className="zm-orbit-visual group relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      aria-label="Ver funil completo de desempenho"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="zm-orbit-visual__svg">
        {rings.map((ring, i) => {
          const r = baseR - i * (stroke + gap);
          const { dash, circ } = ringArc(r, ring.pct, stroke);
          return (
            <g key={ring.label}>
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke="rgba(148,163,184,0.2)"
                strokeWidth={stroke}
              />
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={ring.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={dash}
                strokeDashoffset={circ * 0.25}
                className="transition-all duration-700 group-hover:opacity-90"
                style={{ filter: `drop-shadow(0 0 6px ${ring.color}55)` }}
              />
            </g>
          );
        })}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          className="fill-slate-900 select-none"
          style={{ fontSize: size * 0.11, fontWeight: 800 }}
        >
          {centerValue}
        </text>
        <text
          x={cx}
          y={cy + size * 0.07}
          textAnchor="middle"
          className="fill-slate-500 select-none uppercase"
          style={{ fontSize: size * 0.045, fontWeight: 700, letterSpacing: '0.12em' }}
        >
          {centerLabel}
        </text>
      </svg>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-left">
        {rings.map((ring) => (
          <li key={ring.label} className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ring.color }} />
            <span className="text-[10px] font-bold text-slate-500 truncate">{ring.label}</span>
            <span className="text-[11px] font-black tabular-nums text-slate-900 ml-auto">
              {ring.value.toLocaleString('pt-BR')}
            </span>
          </li>
        ))}
      </ul>
    </button>
  );
};
