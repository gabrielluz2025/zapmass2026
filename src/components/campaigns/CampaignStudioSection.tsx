import React from 'react';

/** Card de seção alinhado ao visual Broadcast Studio (índigo, superfícies claras). */
export const CampaignStudioSection: React.FC<{
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, action, children, className = '' }) => (
  <section
    className={`rounded-2xl overflow-hidden ${className}`}
    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
  >
    <div
      className="px-4 py-3 sm:px-5 flex items-start justify-between gap-3"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="w-1 h-4 rounded-full shrink-0"
            style={{ background: 'linear-gradient(180deg, #6366f1, #22d3ee)' }}
          />
          <h2 className="text-[14px] font-black truncate" style={{ color: 'var(--text-1)' }}>
            {title}
          </h2>
        </div>
        {subtitle && (
          <p className="text-[11px] mt-0.5 pl-3" style={{ color: 'var(--text-3)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
    <div className="p-4 sm:p-5">{children}</div>
  </section>
);
