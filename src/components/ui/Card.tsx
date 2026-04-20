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
}

export const CardHeader: React.FC<CardHeaderProps> = ({
  title,
  subtitle,
  actions,
  icon,
  className = '',
  children,
  ...rest
}) => {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`} {...rest}>
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {icon && (
          <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center brand-soft">
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {title && <h3 className="ui-title text-[15px] truncate">{title}</h3>}
          {subtitle && <p className="ui-subtitle text-[12.5px] mt-0.5">{subtitle}</p>}
          {children}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
};
