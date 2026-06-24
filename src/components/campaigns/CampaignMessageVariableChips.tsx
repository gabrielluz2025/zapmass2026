import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { WIZARD_CAMPAIGN_VARS_FICHA, WIZARD_CAMPAIGN_VARS_PRIMARY } from '../../utils/campaignMessageVariables';
import { useAppProfile } from '../../context/AppProfileContext';

export type CampaignMessageVariableChipsDensity = 'full' | 'compact';

type Props = {
  onInsert: (token: string) => void;
  /** `compact`: menos texto explicativo (ex.: fluxo por respostas, variante A/B). */
  density?: CampaignMessageVariableChipsDensity;
  /** Recolhe a grade de variáveis (padrão em `full`). */
  collapsible?: boolean;
};

export const CampaignMessageVariableChips: React.FC<Props> = ({
  onInsert,
  density = 'full',
  collapsible = false
}) => {
  const { segment } = useAppProfile();
  const isFull = density === 'full';
  const [expanded, setExpanded] = useState(!collapsible);

  const fichaVars = useMemo(() => {
    if (segment === 'religious') {
      return WIZARD_CAMPAIGN_VARS_FICHA.filter((v) => v !== '{data_bodas}' && v !== '{anos_casamento}');
    }
    return WIZARD_CAMPAIGN_VARS_FICHA;
  }, [segment]);

  const fichaHintFull =
    segment === 'religious'
      ? 'Nome completo, contato e aniversário (ficha — ficam vazios se não existirem no contato)'
      : 'Nome completo, contato, aniversário e bodas (ficha — ficam vazios se não existirem no contato)';
  const collapsed = collapsible && !expanded;

  return (
    <div className="campaign-message-variable-chips" data-collapsed={collapsed ? 'true' : 'false'}>
      {collapsible ? (
        <button
          type="button"
          className="cw-vars-toggle"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
        >
          <span>Variáveis de personalização ({WIZARD_CAMPAIGN_VARS_PRIMARY.length + fichaVars.length})</span>
          <ChevronDown
            className="w-4 h-4 shrink-0 transition-transform"
            style={{ transform: expanded ? 'rotate(180deg)' : undefined }}
          />
        </button>
      ) : (
        <p className="cw-vars-group-label">Variáveis rápidas</p>
      )}
      <div className="cw-vars-body">
        <p className="cw-vars-group-label">Principais</p>
        <div className="flex flex-wrap gap-1 mb-1">
          {WIZARD_CAMPAIGN_VARS_PRIMARY.map((v) => (
            <button
              key={v}
              type="button"
              title={
                v === '{horario}'
                  ? 'Bom dia, Boa tarde ou Boa noite (horário de Brasília na fila)'
                  : v === '{hora}'
                    ? 'Hora em Brasília (HH:mm) no envio'
                    : v === '{data}'
                      ? 'Data em Brasília no envio'
                      : undefined
              }
              onClick={() => onInsert(v)}
              className="cw-vars-chip cw-vars-chip--primary"
            >
              {v}
            </button>
          ))}
        </div>
        <p className="cw-vars-group-label">{isFull ? 'Ficha do contato' : 'Ficha (mesmo campo)'}</p>
        <div className="flex flex-wrap gap-1 mb-1">
          {fichaVars.map((v) => (
            <button key={v} type="button" onClick={() => onInsert(v)} className="cw-vars-chip cw-vars-chip--ficha">
              {v}
            </button>
          ))}
        </div>
        {isFull ? (
          <p className="text-[10px] leading-snug" style={{ color: 'var(--text-3)' }}>
            {fichaHintFull}. Também aceita <span className="font-mono">{'{{variavel}}'}</span>.
          </p>
        ) : (
          <p className="text-[10px] leading-snug" style={{ color: 'var(--text-3)' }}>
            Aceita <span className="font-mono">{'{{variavel}}'}</span>.
          </p>
        )}
      </div>
    </div>
  );
};
