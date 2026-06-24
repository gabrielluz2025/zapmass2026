import React from 'react';
import { useAppView } from '../../context/AppViewContext';
import { AiAssistantChat } from './AiAssistantChat';

/** Aba dedicada — Assistente IA em tela cheia. */
export const AiAssistantTab: React.FC = () => {
  const { currentView } = useAppView();
  return (
    <div className="zm-ai-page">
      <AiAssistantChat screen={currentView === 'ai-assistant' ? 'ai-assistant' : currentView} variant="page" />
    </div>
  );
};
