import React from 'react';

export type TabBarItem = {
  id: string;
  label: string;
  Icon?: React.FC<{ className?: string }>;
  activeClass?: string;
};

type TabBarProps = {
  items: TabBarItem[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  className?: string;
};

export const TabBar: React.FC<TabBarProps> = ({ items, activeId, onChange, ariaLabel, className = '' }) => (
  <nav
    className={`flex gap-0.5 overflow-x-auto px-2 sm:px-3 pb-2 scrollbar-thin ${className}`.trim()}
    aria-label={ariaLabel}
  >
    {items.map(({ id, label, Icon, activeClass = 'text-[var(--accent)]' }) => {
      const active = activeId === id;
      return (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`shrink-0 px-3.5 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
            active
              ? `${activeClass} bg-[var(--surface-2)] ring-1 ring-[var(--border-subtle)]`
              : 'text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--surface-1)]'
          }`}
        >
          {Icon ? <Icon className="w-3.5 h-3.5" /> : null}
          {label}
        </button>
      );
    })}
  </nav>
);
