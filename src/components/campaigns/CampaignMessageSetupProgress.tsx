import React from 'react';
import { CheckCircle2, Circle, PartyPopper } from 'lucide-react';

export type SetupProgressItem = {
  id: string;
  label: string;
  done: boolean;
  hint?: string;
};

type Props = {
  items: SetupProgressItem[];
};

/** Barra de progresso do passo Mensagem — mostra o que falta configurar. */
export const CampaignMessageSetupProgress: React.FC<Props> = ({ items }) => {
  const doneCount = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;
  const complete = items.length > 0 && doneCount === items.length;

  return (
    <div className="cw-setup-progress" data-complete={complete ? 'true' : 'false'}>
      {complete ? (
        <div className="cw-setup-progress__celebrate" role="status">
          <PartyPopper className="w-4 h-4 shrink-0" aria-hidden />
          <span>
            <strong>Checklist completo!</strong> Revise a prévia ao lado e avance para escolher os chips de envio.
          </span>
        </div>
      ) : null}
      <div className="cw-setup-progress__head">
        <div>
          <p className="cw-setup-progress__title">Checklist da mensagem</p>
          <p className="cw-setup-progress__sub">
            {complete
              ? 'Obrigatórios concluídos — anexo continua opcional.'
              : `${items.length - doneCount} pendência${items.length - doneCount !== 1 ? 's' : ''} antes de avançar`}
          </p>
        </div>
        <span className="cw-setup-progress__pct" data-complete={complete ? 'true' : 'false'}>
          {pct}%
        </span>
      </div>
      <div className="cw-setup-progress__track" aria-hidden>
        <div className="cw-setup-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <ul className="cw-setup-progress__list">
        {items.map((item) => (
          <li key={item.id} className="cw-setup-progress__item" data-done={item.done ? 'true' : 'false'}>
            {item.done ? (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 cw-setup-progress__icon--done" aria-hidden />
            ) : (
              <Circle className="w-3.5 h-3.5 shrink-0 cw-setup-progress__icon" aria-hidden />
            )}
            <div className="min-w-0">
              <span className="cw-setup-progress__label">{item.label}</span>
              {!item.done && item.hint ? (
                <span className="cw-setup-progress__hint">{item.hint}</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
