import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'compact' | 'premium' | 'glass';
  as?: keyof JSX.IntrinsicElements;
}

const variantClass = {
  default: 'ui-card',
  compact: 'ui-card-compact',
  premium: 'premium-card',
  glass: 'glass-panel rounded-2xl p-5'
};

export const Card: React.FC<CardProps> = ({
  variant = 'default',
  as: Tag = 'div',
  className = '',
  children,
  ...rest
}) => {
  const Comp = Tag as React.ElementType;
  return (
    <Comp className={`${variantClass[variant]} ${className}`} {...rest}>
      {children}
    </Comp>
  );
};

interface CardHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  /** Menos padding; subtítulo em 1 linha. */
  compact?: boolean;
}

export const CardHeader: React.FC<CardHeaderProps> = ({
  title,
  subtitle,
  actions,
  icon,
  compact = false,
  className = '',
  children,
  ...rest
}) => {
  return (
    <div
      className={`flex items-center justify-between gap-4 ${compact ? 'py-0.5' : ''} ${className}`}
      {...rest}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {icon && (
          <div
            className={`flex-shrink-0 rounded-lg flex items-center justify-center brand-soft ${compact ? 'w-8 h-8' : 'w-9 h-9'}`}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {title && (
            <h3 className={`ui-title truncate ${compact ? '' : ''}`}>{title}</h3>
          )}
          {subtitle && (
            <p className={`ui-subtitle mt-0.5 ${compact ? 'line-clamp-1' : 'line-clamp-2'}`}>{subtitle}</p>
          )}
          {children}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0 self-center">{actions}</div>}
    </div>
  );
};
