import React from 'react';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  icon?: React.ReactNode;
  dot?: boolean;
}

const variantClass: Record<BadgeVariant, string> = {
  success: 'ui-badge-success',
  warning: 'ui-badge-warning',
  danger: 'ui-badge-danger',
  info: 'ui-badge-info',
  neutral: 'ui-badge-neutral'
};

const dotColor: Record<BadgeVariant, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-blue-500',
  neutral: 'bg-slate-400'
};

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  icon,
  dot,
  className = '',
  children,
  ...rest
}) => {
  return (
    <span className={`ui-badge ${variantClass[variant]} ${className}`} {...rest}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColor[variant]}`} />}
      {icon}
      {children}
    </span>
  );
};
