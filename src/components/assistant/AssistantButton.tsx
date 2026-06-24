import React, { useState } from 'react';
import { Bot } from 'lucide-react';
import { AssistantPanel } from './AssistantPanel';

type Props = {
  currentView?: string;
  onNavigate?: (view: string) => void;
};

export const AssistantButton: React.FC<Props> = ({ currentView, onNavigate }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Assistente ZapMass — ajuda e seus números"
        className="flex h-9 items-center gap-1.5 rounded-full border pl-2.5 pr-2.5 sm:pr-3 shrink-0 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
        style={{
          borderColor: 'rgba(16,185,129,0.35)',
          background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(59,130,246,0.06))',
          color: 'var(--text-2)'
        }}
      >
        <Bot className="h-4 w-4 text-emerald-500" />
        <span className="hidden sm:inline text-[11px] font-semibold">Assistente</span>
      </button>
      <AssistantPanel
        open={open}
        onClose={() => setOpen(false)}
        currentView={currentView}
        onNavigate={onNavigate}
      />
    </>
  );
};
