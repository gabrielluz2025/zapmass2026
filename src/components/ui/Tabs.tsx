import React from 'react';

export interface TabItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  size?: 'sm' | 'md';
}

export const Tabs: React.FC<TabsProps> = ({ items, value, onChange, className = '', size = 'md' }) => {
  return (
    <div className={`ui-tabs ${className}`}>
      {items.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={`ui-tab ui-focus-ring ${active ? 'ui-tab-active' : ''} ${size === 'sm' ? 'text-[11.5px] px-3 py-1.5' : ''} ${item.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge && <span className="ml-1">{item.badge}</span>}
          </button>
        );
      })}
    </div>
  );
};
