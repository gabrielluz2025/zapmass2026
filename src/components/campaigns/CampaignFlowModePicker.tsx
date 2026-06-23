import React from 'react';
import { GitBranch, MessageSquare, Zap } from 'lucide-react';

export type CampaignFlowMode = 'single' | 'sequential' | 'reply';

type Props = {
  mode: CampaignFlowMode;
  onChange: (mode: CampaignFlowMode) => void;
};

/** Modos visíveis no wizard — `sequential` mantido no tipo só para campanhas antigas. */
const VISIBLE_MODES: Array<{
  id: Exclude<CampaignFlowMode, 'sequential'>;
  title: string;
  desc: string;
  icon: React.ReactNode;
  accent: string;
  recommended?: boolean;
}> = [
  {
    id: 'single',
    title: 'Disparo único',
    desc: 'Uma mensagem para cada contato — avisos, convites e promoções.',
    icon: <MessageSquare className="w-5 h-5" />,
    accent: '#10b981',
    recommended: true,
  },
  {
    id: 'reply',
    title: 'Fluxo por respostas',
    desc: 'Envia uma abertura e, quando o contato responder, manda o próximo texto.',
    icon: <GitBranch className="w-5 h-5" />,
    accent: '#6366f1',
  },
];

export const CampaignFlowModePicker: React.FC<Props> = ({ mode, onChange }) => {
  const active = mode === 'sequential' ? 'single' : mode;

  return (
    <div className="cw-msg-section">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4" style={{ color: 'var(--brand-500)' }} />
        <p className="cw-msg-section-title mb-0">Tipo de campanha</p>
      </div>
      <div className="cw-flow-pick-grid" role="group" aria-label="Tipo de campanha">
        {VISIBLE_MODES.map((m) => {
          const isActive = active === m.id;
          return (
            <button
              key={m.id}
              type="button"
              className="cw-flow-pick-card"
              data-active={isActive ? 'true' : 'false'}
              onClick={() => onChange(m.id)}
              style={
                isActive
                  ? {
                      borderColor: `${m.accent}55`,
                      boxShadow: `0 8px 24px ${m.accent}18`,
                    }
                  : undefined
              }
            >
              <div
                className="cw-flow-pick-icon"
                style={{
                  background: isActive ? m.accent : 'var(--surface-2)',
                  color: isActive ? '#fff' : 'var(--text-3)',
                }}
              >
                {m.icon}
              </div>
              <div className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>
                    {m.title}
                  </span>
                  {m.recommended && <span className="cw-flow-badge cw-flow-badge--recommended">Mais usado</span>}
                </div>
                <p className="text-[11.5px] mt-1 leading-snug" style={{ color: 'var(--text-3)' }}>
                  {m.desc}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
