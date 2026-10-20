import React, { useEffect, useState } from 'react';
import { useAppView } from '../../context/AppViewContext';
import { AiAssistantChat } from './AiAssistantChat';
import { AI_ASSIST_PAYLOAD_EVENT, type AiAssistPayload } from '../../utils/aiAssistEvents';

/** Aba dedicada — Agente ZapMass (admin) em tela cheia. */
export const AiAssistantTab: React.FC = () => {
  const { currentView } = useAppView();
  const [assistPayload, setAssistPayload] = useState<AiAssistPayload | null>(null);

  useEffect(() => {
    const onPayload = (e: Event) => {
      const detail = (e as CustomEvent<AiAssistPayload>).detail;
      if (!detail?.question) return;
      setAssistPayload(detail);
    };
    window.addEventListener(AI_ASSIST_PAYLOAD_EVENT, onPayload);
    return () => window.removeEventListener(AI_ASSIST_PAYLOAD_EVENT, onPayload);
  }, []);

  return (
    <div className="zm-ai-page">
      <AiAssistantChat
        screen={assistPayload?.screen ?? (currentView === 'ai-assistant' ? 'ai-assistant' : currentView)}
        context={assistPayload?.context}
        variant="page"
        assistPayload={assistPayload}
        onAssistPayloadConsumed={() => setAssistPayload(null)}
      />
    </div>
  );
};
