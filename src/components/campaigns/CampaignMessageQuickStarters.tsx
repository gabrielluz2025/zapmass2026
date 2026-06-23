import React from 'react';
import { Sparkles, Hand, Calendar, Bell, Tag } from 'lucide-react';

export type MessageQuickStarter = {
  id: string;
  label: string;
  hint: string;
  body: string;
  icon: React.ReactNode;
  accent: string;
};

export const MESSAGE_QUICK_STARTERS: MessageQuickStarter[] = [
  {
    id: 'greeting',
    label: 'Saudação',
    hint: 'Tom leve e pessoal',
    body: 'Olá {nome}, tudo bem? 😊\n\nPassando para dar um oi!',
    icon: <Hand className="w-3.5 h-3.5" />,
    accent: '#10b981',
  },
  {
    id: 'invite',
    label: 'Convite',
    hint: 'Evento ou reunião',
    body: 'Oi {nome}! {saudacao} ☀️\n\nGostaria de convidar você para nosso encontro. Posso te passar os detalhes?',
    icon: <Calendar className="w-3.5 h-3.5" />,
    accent: '#3b82f6',
  },
  {
    id: 'reminder',
    label: 'Lembrete',
    hint: 'Retorno ou follow-up',
    body: 'Olá {nome}, {saudacao}!\n\nEstou passando para lembrar do nosso combinado. Fico no aguardo!',
    icon: <Bell className="w-3.5 h-3.5" />,
    accent: '#f59e0b',
  },
  {
    id: 'promo',
    label: 'Novidade',
    hint: 'Oferta ou lançamento',
    body: 'Oi {nome}! Temos uma novidade especial em {cidade}.\n\nQuer que eu te explique em 2 minutinhos?',
    icon: <Tag className="w-3.5 h-3.5" />,
    accent: '#8b5cf6',
  },
];

type Props = {
  onPick: (body: string) => void;
  disabled?: boolean;
};

/** Atalhos para quem não quer começar do zero — um clique preenche o editor. */
export const CampaignMessageQuickStarters: React.FC<Props> = ({ onPick, disabled }) => (
  <div className="cw-quick-starters">
    <div className="flex items-center gap-2 mb-2">
      <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--brand-500)' }} />
      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
        Começar com um modelo
      </p>
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {MESSAGE_QUICK_STARTERS.map((s) => (
        <button
          key={s.id}
          type="button"
          disabled={disabled}
          onClick={() => onPick(s.body)}
          className="cw-quick-starter-card text-left transition-all disabled:opacity-50"
          style={{ borderColor: `${s.accent}30` }}
        >
          <span
            className="cw-quick-starter-icon"
            style={{ background: `${s.accent}18`, color: s.accent }}
          >
            {s.icon}
          </span>
          <span className="text-[12px] font-bold block" style={{ color: 'var(--text-1)' }}>
            {s.label}
          </span>
          <span className="text-[10px] block mt-0.5 leading-snug" style={{ color: 'var(--text-3)' }}>
            {s.hint}
          </span>
        </button>
      ))}
    </div>
  </div>
);
