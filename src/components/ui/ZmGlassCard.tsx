import React from 'react';

type ZmGlassCardProps = {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
  as?: 'div' | 'section' | 'article';
};

const padClass: Record<NonNullable<ZmGlassCardProps['padding']>, string> = {
  none: '',
  sm: 'zm-glass-card-v2--pad-sm',
  md: 'zm-glass-card-v2--pad-md',
  lg: 'zm-glass-card-v2--pad-lg',
};

export const ZmGlassCard: React.FC<ZmGlassCardProps> = ({
  children,
  className = '',
  padding = 'md',
  hover = false,
  as: Tag = 'div',
}) => (
  <Tag
    className={`zm-glass-card-v2 ${padClass[padding]} ${hover ? 'zm-glass-card-v2--hover' : ''} ${className}`.trim()}
  >
    {children}
  </Tag>
);
