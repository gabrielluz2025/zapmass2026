import React from 'react';

type StatTileProps = {
  label: string;
  value: React.ReactNode;
  hint?: string;
  warn?: boolean;
  className?: string;
};

/** Métrica compacta — número + rótulo caption (sem borda interna). */
export const StatTile: React.FC<StatTileProps> = ({ label, value, hint, warn, className = '' }) => (
  <div className={`zm-stat-tile ${warn ? 'zm-stat-tile--warn' : ''} ${className}`.trim()}>
    <span className="ui-overline">{label}</span>
    <span className="zm-stat-tile__value">{value}</span>
    {hint && <span className="ui-caption zm-stat-tile__hint">{hint}</span>}
  </div>
);
