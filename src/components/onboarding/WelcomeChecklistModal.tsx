import React, { useState, useCallback } from 'react';
import { CheckCircle2, Circle, Wifi, Megaphone, Bot, ArrowRight, X, Zap } from 'lucide-react';

interface CheckStep {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  action: string;
}

const STEPS: CheckStep[] = [
  {
    id: 'chip',
    icon: <Wifi className="w-5 h-5" />,
    title: 'Conecte seu primeiro chip',
    description: 'Vá em "Conexões", clique em "+ Novo chip" e escaneie o QR code com seu WhatsApp. Chip novo? Comece com no máximo 100 mensagens/dia.',
    action: 'Ir para Conexões',
  },
  {
    id: 'campaign',
    icon: <Megaphone className="w-5 h-5" />,
    title: 'Crie sua primeira campanha',
    description: 'Em "Campanhas", use um template da galeria ou escreva sua própria mensagem. Configure o intervalo anti-ban (recomendado: 15–45s).',
    action: 'Ir para Campanhas',
  },
  {
    id: 'bot',
    icon: <Bot className="w-5 h-5" />,
    title: 'Configure o atendimento automático (opcional)',
    description: 'Em "Configurações → Atendimento Automático", crie um menu de respostas para que seus contatos sejam atendidos mesmo fora do horário.',
    action: 'Ir para Configurações',
  },
];

const STORAGE_KEY = 'zapmass_welcome_dismissed';

export function useWelcomeChecklist(uid: string | null | undefined) {
  const storageKey = uid ? `${STORAGE_KEY}_${uid}` : STORAGE_KEY;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(storageKey, '1');
    } catch {
      // ignora
    }
    setDismissed(true);
  }, [storageKey]);

  return { show: !dismissed, dismiss };
}

interface WelcomeChecklistModalProps {
  onClose: () => void;
  onNavigate?: (tab: string) => void;
}

export const WelcomeChecklistModal: React.FC<WelcomeChecklistModalProps> = ({ onClose, onNavigate }) => {
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const tabMap: Record<string, string> = {
    chip: 'connections',
    campaign: 'campaigns',
    bot: 'settings',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
      <div
        className="relative w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--surface, #111827)', border: '1px solid rgba(16,185,129,0.25)' }}
      >
        {/* Header */}
        <div className="relative px-6 pt-6 pb-5 text-center overflow-hidden">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse at 50% -20%, rgba(16,185,129,0.18), transparent 65%)',
            }}
          />
          <div className="relative z-10">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3"
              style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)' }}>
              <Zap className="w-7 h-7 text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold" style={{ color: 'var(--text, #f3f4f6)' }}>
              Bem-vindo ao ZapMass!
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-2, #9ca3af)' }}>
              Siga os 3 passos abaixo para começar a usar em minutos.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/10 transition"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" style={{ color: 'var(--text-3, #6b7280)' }} />
          </button>
        </div>

        {/* Steps */}
        <div className="px-5 pb-4 space-y-3">
          {STEPS.map((step, idx) => {
            const done = completed.has(step.id);
            return (
              <div
                key={step.id}
                className="rounded-xl p-4 transition-all cursor-pointer"
                style={{
                  background: done ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${done ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.08)'}`,
                }}
                onClick={() => toggle(step.id)}
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <div className="mt-0.5 flex-shrink-0">
                    {done
                      ? <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      : <Circle className="w-5 h-5" style={{ color: 'var(--text-3, #6b7280)' }} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{
                          background: 'rgba(16,185,129,0.15)',
                          color: 'var(--emerald, #10b981)',
                        }}
                      >
                        {idx + 1}
                      </span>
                      <p
                        className={`text-[14px] font-semibold ${done ? 'line-through opacity-50' : ''}`}
                        style={{ color: 'var(--text, #f3f4f6)' }}
                      >
                        {step.title}
                      </p>
                    </div>
                    <p className="text-[12px] leading-snug" style={{ color: 'var(--text-2, #9ca3af)' }}>
                      {step.description}
                    </p>
                    {onNavigate && !done && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigate(tabMap[step.id]);
                          onClose();
                        }}
                        className="mt-2 flex items-center gap-1 text-[12px] font-semibold transition-colors"
                        style={{ color: 'var(--emerald, #10b981)' }}
                      >
                        {step.action} <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5">
          <p className="text-[11px] text-center mb-3" style={{ color: 'var(--text-3, #6b7280)' }}>
            Clique em cada passo para marcar como feito. Você pode reabrir este guia a qualquer momento em Ajuda.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl font-semibold text-sm transition-all"
            style={{
              background: 'linear-gradient(135deg, #10b981, #059669)',
              color: '#fff',
            }}
          >
            {completed.size >= STEPS.length ? 'Concluído! Começar a usar 🚀' : 'Entendi, vou explorar'}
          </button>
        </div>
      </div>
    </div>
  );
};
