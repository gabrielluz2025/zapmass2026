import React from 'react';
import { Check, CheckCheck, Clock } from 'lucide-react';
import type { ChatMessage } from '../../../types';

interface WaBubbleProps {
  side: 'in' | 'out';
  /** Renderiza a "cauda" (tail) à esquerda/direita; usar só na primeira msg do bloco. */
  showTail?: boolean;
  /** Estado de envio (define os ticks ✓✓ no canto). Só aplicável a `side='out'`. */
  status?: ChatMessage['status'];
  /** Hora curta exibida no canto inferior direito da bolha (ex.: "10:42"). */
  time?: string;
  /** Mensagem originada de disparo de campanha. */
  fromCampaign?: boolean;
  children: React.ReactNode;
}

/**
 * Bolha de mensagem com a aparência do WhatsApp Web.
 * Inclui a "cauda" SVG via CSS (data-tail) e os ticks ✓/✓✓ azuis para entregue/lido.
 */
export const WaBubble: React.FC<WaBubbleProps> = ({
  side,
  showTail,
  status,
  time,
  fromCampaign,
  children
}) => {
  return (
    <div className={`flex ${side === 'out' ? 'justify-end' : 'justify-start'} px-3 my-[1px]`}>
      <div
        className="wa-bubble"
        data-side={side}
        data-tail={showTail ? 'true' : 'false'}
        data-status={side === 'out' && status ? status : undefined}
      >
        {fromCampaign && side === 'out' ? (
          <span className="wa-campaign-tag">Campanha</span>
        ) : null}
        <span>{children}</span>
        <span className="wa-bubble-meta">
          {time}
          {side === 'out' && status === 'pending' && (
            <Clock className="wa-tick wa-tick-pending" strokeWidth={2.5} />
          )}
          {side === 'out' && status === 'sent' && <Check className="wa-tick" strokeWidth={2.5} />}
          {side === 'out' && status === 'delivered' && <CheckCheck className="wa-tick" strokeWidth={2.5} />}
          {side === 'out' && status === 'read' && (
            <CheckCheck className="wa-tick" data-state="read" strokeWidth={2.5} />
          )}
        </span>
      </div>
    </div>
  );
};
