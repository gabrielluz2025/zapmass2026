import React from 'react';

export type ZmMetricAccent = 'emerald' | 'cyan' | 'violet' | 'amber' | 'pink' | 'slate';

type ZmMetricCardProps = {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  helper?: React.ReactNode;
  accent?: ZmMetricAccent;
  onClick?: () => void;
  className?: string;
};

export const ZmMetricCard: React.FC<ZmMetricCardProps> = ({
  label,
  value,
  icon,
  helper,
  accent = 'emerald',
  onClick,
  className = '',
}) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`zm-metric-card zm-metric-card--accent-${accent} ${
        onClick ? 'zm-metric-card--clickable' : ''
      } ${className}`.trim()}
    >
      <div className="zm-metric-card__top">
        <span className="zm-metric-card__label">{label}</span>
        {icon ? <span className="zm-metric-card__icon">{icon}</span> : null}
      </div>
      <div className="zm-metric-card__value">{value}</div>
      {helper ? <div className="zm-metric-card__helper">{helper}</div> : null}
    </Tag>
  );
};
