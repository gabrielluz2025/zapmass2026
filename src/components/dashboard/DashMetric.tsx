import React from 'react';

/** Rótulo + valor (canais / RAM) — reutilizável no painel e no dashboard. */
export const DashMetric: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({
  label,
  value,
  hint
}) => (
  <div className="flex flex-col gap-0.5 min-w-0">
    <span className="text-[10px] font-medium" style={{ color: 'var(--text-3)' }}>
      {label}
    </span>
    <div className="text-sm font-semibold tabular-nums leading-tight" style={{ color: 'var(--text-1)' }}>
      {value}
    </div>
    {hint && (
      <span className="text-[10px] leading-snug" style={{ color: 'var(--text-3)' }}>
        {hint}
      </span>
    )}
  </div>
);
