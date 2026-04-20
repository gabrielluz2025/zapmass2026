import React from 'react';

interface SectionHeaderProps {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  eyebrow,
  title,
  description,
  actions,
  icon,
  className = ''
}) => {
  return (
    <div className={`flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 ${className}`}>
      <div className="flex items-start gap-4 min-w-0">
        {icon && (
          <div className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center brand-soft">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && <div className="ui-eyebrow mb-1.5">{eyebrow}</div>}
          <h1 className="text-[22px] sm:text-[26px] font-bold tracking-tight leading-tight" style={{ color: 'var(--text-1)' }}>
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 text-[13.5px] max-w-2xl leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
};
