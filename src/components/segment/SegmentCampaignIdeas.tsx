import React, { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { useAppProfile } from '../../context/AppProfileContext';
import { getSegmentExperience } from '../../constants/segmentExperience';

type Props = {
  /** Substitui o texto da etapa activa pelo modelo escolhido. */
  onApplyTemplate: (body: string) => void;
};

/**
 * Faixa compacta no passo de mensagem do assistente de campanhas.
 */
export const SegmentCampaignIdeas: React.FC<Props> = ({ onApplyTemplate }) => {
  const { segment } = useAppProfile();
  const xp = useMemo(() => getSegmentExperience(segment), [segment]);
  if (!xp.messageBlueprints.length) return null;

  return (
    <div
      className="rounded-xl p-3 mb-2 space-y-2"
      style={{
        background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(59,130,246,0.06))',
        border: '1px solid rgba(16,185,129,0.22)'
      }}
    >
      <p className="text-[10.5px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
        <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
        Ideias para o seu segmento
      </p>
      <div className="flex flex-wrap gap-1.5">
        {xp.messageBlueprints.map((bp) => (
          <button
            key={bp.id}
            type="button"
            onClick={() => onApplyTemplate(bp.body)}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all hover:brightness-110"
            style={{ background: 'var(--surface-0)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
            title={bp.body}
          >
            {bp.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] leading-snug" style={{ color: 'var(--text-3)' }}>
        Clicar substitui o texto desta etapa — pode editar em seguida.
      </p>
    </div>
  );
};
