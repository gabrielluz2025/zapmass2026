import React from 'react';
import { Check, CheckCheck } from 'lucide-react';
import type { ChatMessage } from '../../../types';

interface WaBubbleProps {
  side: 'in' | 'out';
  /** Renderiza a "cauda" (tail) à esquerda/direita; usar só na primeira msg do bloco. */
  showTail?: boolean;
  /** Estado de envio (define os ticks ✓✓ no canto). Só aplicável a `side='out'`. */
  status?: ChatMessage['status'];
  /** Hora curta exibida no canto inferior direito da bolha (ex.: "10:42"). */
  time?: string;
  children: React.ReactNode;
}

/**
 * Bolha de mensagem com a aparência do WhatsApp Web.
 * Inclui a "cauda" SVG via CSS (data-tail) e os ticks ✓/✓✓ azuis para entregue/lido.
 */
export const WaBubble: React.FC<WaBubbleProps> = ({ side, showTail, status, time, children }) => {
  return (
    <div className={`flex ${side === 'out' ? 'justify-end' : 'justify-start'} px-3 my-[1px]`}>
      <div className="wa-bubble" data-side={side} data-tail={showTail ? 'true' : 'false'}>
        <span>{children}</span>
        <span className="wa-bubble-meta">
          {time}
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
