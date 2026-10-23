import React, { useCallback, useState } from 'react';
import { X, Zap } from 'lucide-react';
import {
  isWelcomeChecklistComplete,
  readWelcomeChecklistDismissed,
  WelcomeChecklistPanel,
  writeWelcomeChecklistDismissed,
  type WelcomeChecklistProgress,
} from './welcomeChecklistShared';

export function useWelcomeChecklist(uid: string | null | undefined, progress?: WelcomeChecklistProgress) {
  const [dismissed, setDismissed] = useState(() => readWelcomeChecklistDismissed(uid));

  const dismiss = useCallback(() => {
    writeWelcomeChecklistDismissed(uid);
    setDismissed(true);
  }, [uid]);

  const complete = progress ? isWelcomeChecklistComplete(progress) : false;
  const show = !dismissed && !complete;

  return { show, dismiss };
}

interface WelcomeChecklistModalProps {
  progress: WelcomeChecklistProgress;
  onClose: () => void;
  onNavigate?: (tab: string) => void;
}

export const WelcomeChecklistModal: React.FC<WelcomeChecklistModalProps> = ({
  progress,
  onClose,
  onNavigate,
}) => {
  const complete = isWelcomeChecklistComplete(progress);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
      <div
        className="relative w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--surface, #111827)', border: '1px solid rgba(16,185,129,0.25)' }}
      >
        <div className="relative px-6 pt-6 pb-5 text-center overflow-hidden">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse at 50% -20%, rgba(16,185,129,0.18), transparent 65%)',
            }}
          />
          <div className="relative z-10">
            <div
              className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3"
              style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)' }}
            >
              <Zap className="w-7 h-7 text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold" style={{ color: 'var(--text, #f3f4f6)' }}>
              Bem-vindo ao ZapMass!
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-2, #9ca3af)' }}>
              Três passos para sua primeira campanha — marcamos o que já está pronto na conta.
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

        <div className="px-5 pb-4">
          <WelcomeChecklistPanel
            progress={progress}
            onNavigate={
              onNavigate
                ? (view) => {
                    onNavigate(view);
                    onClose();
                  }
                : undefined
            }
          />
        </div>

        <div className="px-5 pb-5">
          <p className="text-[11px] text-center mb-3" style={{ color: 'var(--text-3, #6b7280)' }}>
            Oculto nesta sessão ao fechar. Reabra pelo checklist no Painel.
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
            {complete ? 'Tudo pronto — começar 🚀' : 'Entendi, vou configurar'}
          </button>
        </div>
      </div>
    </div>
  );
};
