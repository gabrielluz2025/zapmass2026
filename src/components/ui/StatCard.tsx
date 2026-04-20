import React from 'react';

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  helper?: React.ReactNode;
  trend?: { value: number; positive?: boolean };
  accent?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
}

const accentBg: Record<NonNullable<StatCardProps['accent']>, string> = {
  default: 'brand-soft',
  success: 'ui-badge-success',
  warning: 'ui-badge-warning',
  danger: 'ui-badge-danger',
  info: 'ui-badge-info'
};

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  icon,
  helper,
  trend,
  accent = 'default',
  className = ''
}) => {
  return (
    <div className={`ui-stat ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className="ui-eyebrow">{label}</span>
        {icon && (
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${accentBg[accent]}`}>
            {icon}
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-[28px] font-bold tracking-tight leading-none" style={{ color: 'var(--text-1)' }}>
          {value}
        </div>
        {trend && (
          <span className={`text-[11.5px] font-semibold ${trend.positive ? 'text-emerald-500' : 'text-red-500'}`}>
            {trend.positive ? '+' : ''}{trend.value}%
          </span>
        )}
      </div>
      {helper && <div className="text-[12px] mt-1.5" style={{ color: 'var(--text-3)' }}>{helper}</div>}
    </div>
  );
};
