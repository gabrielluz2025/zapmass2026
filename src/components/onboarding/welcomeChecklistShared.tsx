import React from 'react';
import { ArrowRight, CheckCircle2, Circle, Megaphone, Users, Wifi, X, Zap } from 'lucide-react';
import { ConnectionStatus, type Campaign, type WhatsAppConnection } from '../../types';

export type WelcomeChecklistProgress = {
  hasChip: boolean;
  hasContacts: boolean;
  hasCampaign: boolean;
};

export function computeWelcomeChecklistProgress(
  connections: WhatsAppConnection[],
  contactsSavedTotal: number | null | undefined,
  campaigns: Campaign[]
): WelcomeChecklistProgress {
  const hasChip = connections.some((c) => c.status === ConnectionStatus.CONNECTED);
  const totalContacts = contactsSavedTotal ?? 0;
  const hasContacts = totalContacts > 0;
  const hasCampaign = campaigns.length > 0;
  return { hasChip, hasContacts, hasCampaign };
}

export function isWelcomeChecklistComplete(p: WelcomeChecklistProgress): boolean {
  return p.hasChip && p.hasContacts && p.hasCampaign;
}

const STORAGE_KEY = 'zapmass_welcome_dismissed';

export function welcomeChecklistStorageKey(uid: string | null | undefined): string {
  return uid ? `${STORAGE_KEY}_${uid}` : STORAGE_KEY;
}

export function readWelcomeChecklistDismissed(uid: string | null | undefined): boolean {
  try {
    return sessionStorage.getItem(welcomeChecklistStorageKey(uid)) === '1';
  } catch {
    return false;
  }
}

export function writeWelcomeChecklistDismissed(uid: string | null | undefined): void {
  try {
    sessionStorage.setItem(welcomeChecklistStorageKey(uid), '1');
  } catch {
    /* ignore */
  }
}

type StepDef = {
  id: keyof WelcomeChecklistProgress;
  view: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  action: string;
};

const STEPS: StepDef[] = [
  {
    id: 'hasChip',
    view: 'connections',
    icon: <Wifi className="w-5 h-5" />,
    title: 'Conecte um chip WhatsApp',
    description: 'Em Conexões, adicione um canal e escaneie o QR. Chips novos: comece com ~100 envios/dia.',
    action: 'Ir para Conexões',
  },
  {
    id: 'hasContacts',
    view: 'contacts',
    icon: <Users className="w-5 h-5" />,
    title: 'Importe ou sincronize contatos',
    description: 'Planilha CSV/XLSX, vCard ou sync com o celular — sua base alimenta campanhas e o mapa por região.',
    action: 'Ir para Contatos',
  },
  {
    id: 'hasCampaign',
    view: 'campaigns',
    icon: <Megaphone className="w-5 h-5" />,
    title: 'Crie sua primeira campanha',
    description: 'Use um template ou escreva a mensagem. Intervalo anti-ban recomendado: 15–45 s entre envios.',
    action: 'Ir para Campanhas',
  },
];

type PanelProps = {
  progress: WelcomeChecklistProgress;
  onNavigate?: (view: string) => void;
  compact?: boolean;
};

export const WelcomeChecklistPanel: React.FC<PanelProps> = ({ progress, onNavigate, compact }) => {
  const doneCount = STEPS.filter((s) => progress[s.id]).length;

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {!compact && (
        <p className="text-[12px] text-center" style={{ color: 'var(--text-3)' }}>
          {doneCount} de {STEPS.length} concluídos — dados reais da sua conta.
        </p>
      )}
      {STEPS.map((step, idx) => {
        const done = progress[step.id];
        return (
          <div
            key={step.id}
            className="rounded-xl p-4 transition-all"
            style={{
              background: done ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${done ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.08)'}`,
            }}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex-shrink-0">
                {done ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <Circle className="w-5 h-5" style={{ color: 'var(--text-3)' }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}
                  >
                    {idx + 1}
                  </span>
                  <p
                    className={`text-[14px] font-semibold ${done ? 'opacity-80' : ''}`}
                    style={{ color: 'var(--text-1)' }}
                  >
                    {step.title}
                  </p>
                </div>
                <p className="text-[12px] leading-snug" style={{ color: 'var(--text-2)' }}>
                  {step.description}
                </p>
                {onNavigate && !done && (
                  <button
                    type="button"
                    onClick={() => onNavigate(step.view)}
                    className="mt-2 flex items-center gap-1 text-[12px] font-semibold transition-colors"
                    style={{ color: '#10b981' }}
                  >
                    {step.action} <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
              <span className="opacity-40 shrink-0 hidden sm:block">{step.icon}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

type CardProps = {
  progress: WelcomeChecklistProgress;
  onNavigate: (view: string) => void;
  onDismiss: () => void;
};

export const WelcomeChecklistCard: React.FC<CardProps> = ({ progress, onNavigate, onDismiss }) => {
  if (isWelcomeChecklistComplete(progress)) return null;

  return (
    <div
      className="rounded-2xl p-5 border relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(16,185,129,0.1) 0%, var(--surface-0) 55%)',
        borderColor: 'rgba(16,185,129,0.28)',
      }}
    >
      <button
        type="button"
        onClick={onDismiss}
        className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-white/10 transition"
        aria-label="Ocultar checklist desta sessão"
      >
        <X className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
      </button>
      <div className="flex items-start gap-3 mb-4 pr-8">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)' }}
        >
          <Zap className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-[17px] font-bold" style={{ color: 'var(--text-1)' }}>
            Primeiros passos
          </h2>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-2)' }}>
            Complete o essencial para disparar com segurança.
          </p>
        </div>
      </div>
      <WelcomeChecklistPanel progress={progress} onNavigate={onNavigate} compact />
    </div>
  );
};
