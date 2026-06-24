import React, { useEffect, useState } from 'react';
import { Minimize2, Sparkles, X } from 'lucide-react';
import { useAiStatus } from '../../hooks/useAiStatus';
import { useAppView } from '../../context/AppViewContext';
import { AiAssistantChat } from './AiAssistantChat';

type Props = {
  screen: string;
  context?: unknown;
  placeholder?: string;
  compact?: boolean;
};

/** FAB + painel deslizante do assistente IA. */
export const AiAskPanel: React.FC<Props> = ({ screen, context, placeholder, compact = false }) => {
  const { configured, loading: statusLoading } = useAiStatus();
  const { currentView, setCurrentView } = useAppView();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (currentView === 'ai-assistant') setOpen(false);
  }, [currentView]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (statusLoading || !configured) return null;
  if (currentView === 'ai-assistant') return null;

  if (!open) {
    return (
      <button
        type="button"
        className={`zm-ai-fab${compact ? ' zm-ai-fab--compact' : ''}`}
        onClick={() => setOpen(true)}
        title="Abrir assistente IA"
      >
        <span className="zm-ai-fab__glow" aria-hidden />
        <Sparkles className="w-4 h-4 zm-ai-fab__icon" />
        {!compact && <span>Assistente IA</span>}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className="zm-ai-backdrop"
        aria-label="Fechar assistente"
        onClick={() => setOpen(false)}
      />
      <aside className="zm-ai-drawer" role="dialog" aria-label="Assistente IA">
        <header className="zm-ai-drawer__head">
          <div className="zm-ai-drawer__head-main">
            <Sparkles className="w-4 h-4 text-violet-400" />
            <div>
              <span className="zm-ai-drawer__title">Assistente IA</span>
              <span className="zm-ai-drawer__sub">Dados ao vivo da sua conta</span>
            </div>
          </div>
          <div className="zm-ai-drawer__actions">
            <button
              type="button"
              className="zm-ai-drawer__icon-btn"
              title="Abrir em tela cheia"
              onClick={() => {
                setOpen(false);
                setCurrentView('ai-assistant');
              }}
            >
              <Minimize2 className="w-4 h-4 rotate-90" />
            </button>
            <button
              type="button"
              className="zm-ai-drawer__icon-btn"
              onClick={() => setOpen(false)}
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>
        <AiAssistantChat screen={screen} context={context} variant="drawer" placeholder={placeholder} />
      </aside>
    </>
  );
};
