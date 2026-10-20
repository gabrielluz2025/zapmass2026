import React from 'react';

type CompactPageHeaderProps = {
  icon: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Abas ou toolbar logo abaixo do título (ex.: TabBar). */
  footer?: React.ReactNode;
  className?: string;
};

export const CompactPageHeader: React.FC<CompactPageHeaderProps> = ({
  icon,
  title,
  subtitle,
  footer,
  className = ''
}) => (
  <header
    className={`rounded-xl border overflow-hidden ${className}`.trim()}
    style={{
      borderColor: 'var(--border-subtle)',
      background: 'var(--surface-0)',
      boxShadow: '0 1px 0 color-mix(in srgb, var(--text-1) 4%, transparent)'
    }}
  >
    <div className="px-4 sm:px-5 pt-4 pb-3 flex items-start gap-3 min-w-0">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{
          background: 'color-mix(in srgb, var(--brand-500) 14%, var(--surface-1))',
          boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--brand-500) 22%, transparent)'
        }}
      >
        {icon}
      </div>
      <div className="min-w-0 pt-0.5 flex-1">
        <h2 className="ui-title text-lg sm:text-xl font-bold tracking-tight leading-tight" style={{ color: 'var(--text-1)' }}>
          {title}
        </h2>
        {subtitle ? (
          <p className="text-[13px] mt-1 leading-snug max-w-2xl" style={{ color: 'var(--text-3)' }}>
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
    {footer}
  </header>
);
