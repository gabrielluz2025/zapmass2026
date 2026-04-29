import React, { useMemo } from 'react';

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function strokeForPercent(p: number): string {
  if (p >= 90) return 'var(--ops-hist-high)';
  if (p >= 75) return 'var(--ops-hist-mid)';
  return 'var(--ops-hist-low)';
}

export interface RingGaugeProps {
  /** 0–100 */
  percent: number;
  label: string;
  /** Texto grande no centro */
  primary: string;
  /** Linha fina opcional sob o centro */
  secondary?: string;
  size?: number;
  stroke?: number;
  className?: string;
}

/** Medidor circular estilo conta-giros: arco proporcional ao percentual. */
export const RingGauge: React.FC<RingGaugeProps> = ({
  percent,
  label,
  primary,
  secondary,
  size = 88,
  stroke = 6,
  className = ''
}) => {
  const p = clampPct(percent);
  const r = useMemo(() => (size - stroke * 2) / 2, [size, stroke]);
  const c = useMemo(() => 2 * Math.PI * r, [r]);
  const dashOffset = useMemo(() => c - (p / 100) * c, [c, p]);
  const color = strokeForPercent(p);

  return (
    <div className={`flex flex-col items-center gap-1 min-w-0 ${className}`}>
      <span className="text-[9px] font-semibold uppercase tracking-wide truncate max-w-[8rem] text-center" style={{ color: 'var(--text-3)' }}>
        {label}
      </span>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block" aria-hidden>
          <defs>
            <linearGradient id="ring-muted" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--border-subtle)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--border)" stopOpacity={0.7} />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#ring-muted)" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset 0.45s ease, stroke 0.35s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center px-1 pointer-events-none">
          <span className="text-[15px] font-bold tabular-nums leading-tight" style={{ color: 'var(--text-1)' }}>
            {primary}
          </span>
          {secondary && (
            <span className="text-[9px] font-medium mt-0.5 leading-snug truncate max-w-full text-center" style={{ color: 'var(--text-3)' }}>
              {secondary}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
