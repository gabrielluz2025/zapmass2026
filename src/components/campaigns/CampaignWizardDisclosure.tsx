import React from 'react';
import { ChevronDown, Settings2 } from 'lucide-react';

type Props = {
  title?: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

/** Bloco colapsável para opções avançadas do assistente de campanha. */
export const CampaignWizardDisclosure: React.FC<Props> = ({
  title = 'Opções avançadas',
  summary = 'Pools de chips, pesos, envio fracionado e variações de texto',
  open,
  onToggle,
  children,
}) => (
  <div className="zm-glass-card-v2 zm-glass-card-v2--pad-sm overflow-hidden">
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-3 text-left"
      aria-expanded={open}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)' }}
      >
        <Settings2 className="w-4 h-4 text-violet-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
          {title}
        </p>
        <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
          {summary}
        </p>
      </div>
      <ChevronDown
        className="w-4 h-4 shrink-0 transition-transform"
        style={{
          color: 'var(--text-3)',
          transform: open ? 'rotate(180deg)' : undefined,
        }}
      />
    </button>
    {open ? (
      <div
        className="mt-4 pt-4 space-y-4"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        {children}
      </div>
    ) : null}
  </div>
);
