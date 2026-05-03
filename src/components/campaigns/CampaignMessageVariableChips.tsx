import React from 'react';
import { WIZARD_CAMPAIGN_VARS_FICHA, WIZARD_CAMPAIGN_VARS_PRIMARY } from '../../utils/campaignMessageVariables';

export type CampaignMessageVariableChipsDensity = 'full' | 'compact';

type Props = {
  onInsert: (token: string) => void;
  /** `compact`: menos texto explicativo (ex.: fluxo por respostas, variante A/B). */
  density?: CampaignMessageVariableChipsDensity;
};

export const CampaignMessageVariableChips: React.FC<Props> = ({ onInsert, density = 'full' }) => {
  const isFull = density === 'full';
  return (
    <div className="campaign-message-variable-chips">
      <div className="flex flex-wrap gap-1 mb-1.5">
        {WIZARD_CAMPAIGN_VARS_PRIMARY.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onInsert(v)}
            className="text-[10.5px] font-mono font-semibold px-2 py-0.5 rounded-md transition-all hover:brightness-110"
            style={{ background: 'var(--brand-50)', color: 'var(--brand-700)' }}
          >
            {v}
          </button>
        ))}
      </div>
      <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--text-3)' }}>
        {isFull
          ? 'Nome completo, contato, aniversário e bodas (ficha — ficam vazios se não existirem no contato)'
          : 'Mesmas variáveis do corpo da mensagem (inserem neste campo)'}
      </p>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {WIZARD_CAMPAIGN_VARS_FICHA.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onInsert(v)}
            className="text-[10.5px] font-mono font-semibold px-2 py-0.5 rounded-md transition-all hover:brightness-110"
            style={{
              background: 'var(--surface-1)',
              color: 'var(--brand-700)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            {v}
          </button>
        ))}
      </div>
      {isFull ? (
        <p className="text-[10px] leading-snug mb-2" style={{ color: 'var(--text-3)' }}>
          O servidor também aceita <span className="font-mono">{'{{variavel}}'}</span> (com espaços opcionais).{' '}
          <span className="font-mono">{'{anos_casamento}'}</span> só é preenchido quando a data de casamento no cadastro
          inclui o ano (para calcular as bodas da próxima data).
        </p>
      ) : (
        <p className="text-[10px] leading-snug mb-1.5" style={{ color: 'var(--text-3)' }}>
          Aceita também <span className="font-mono">{'{{variavel}}'}</span>.{' '}
          <span className="font-mono">{'{anos_casamento}'}</span> exige ano na data de casamento no cadastro.
        </p>
      )}
    </div>
  );
};
