import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';

type CollapsibleSectionProps = {
  title: React.ReactNode;
  summary?: React.ReactNode;
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
};

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  summary,
  actions,
  defaultOpen = true,
  children,
  className = ''
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <section className={`zm-section ${className}`.trim()}>
      <div className="zm-section__head">
        <button
          type="button"
          className="zm-section__toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown className={`zm-section__chevron ${open ? 'is-open' : ''}`} aria-hidden />
          <span className="ui-section-title">{title}</span>
          {summary && !open && <span className="ui-caption zm-section__summary">{summary}</span>}
        </button>
        {actions && <div className="zm-section__actions">{actions}</div>}
      </div>
      {open && (
        <div id={panelId} className="zm-section__body">
          {children}
        </div>
      )}
    </section>
  );
};
