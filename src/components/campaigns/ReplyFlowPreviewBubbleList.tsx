import React from 'react';
import { ArrowDown, Reply } from 'lucide-react';
import {
  CampaignFlowPreviewWaIn,
  CampaignFlowPreviewWaOut
} from './CampaignFlowPreviewWaBubble';
import type { ReplyFlowPreviewItem } from '../../utils/campaignReplyFlowPreviewSequence';

type Props = {
  items: ReplyFlowPreviewItem[];
  time?: string;
  compact?: boolean;
  maxHeight?: number;
  emptyLabel?: string;
};

/** Lista de bolhas WhatsApp para prévia de fluxo por resposta (etapa ou fluxo completo). */
export const ReplyFlowPreviewBubbleList: React.FC<Props> = ({
  items,
  time,
  compact = false,
  maxHeight = 280,
  emptyLabel = '(sem mensagens nesta etapa)'
}) => {
  if (items.length === 0) {
    return (
      <p className="text-[11px] py-2 text-center" style={{ color: 'rgba(255,255,255,0.4)' }}>
        {emptyLabel}
      </p>
    );
  }

  return (
    <div
      className="rounded-lg p-2 flex flex-col gap-1.5 overflow-y-auto"
      style={{
        background: 'linear-gradient(180deg, #0b141a 0%, #111b21 100%)',
        border: '1px solid rgba(255,255,255,0.06)',
        maxHeight,
        minHeight: compact ? 72 : 100
      }}
    >
      {items.map((s, idx) => {
        if (s.kind === 'gate') {
          return (
            <div key={idx} className="flex flex-col items-center gap-0.5 py-0.5">
              <ArrowDown className="w-3 h-3" style={{ color: 'rgba(255,255,255,0.35)' }} />
              <div
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold"
                style={{
                  background: 'rgba(245,158,11,0.15)',
                  border: '1px solid rgba(245,158,11,0.35)',
                  color: '#fcd34d'
                }}
              >
                <Reply className="w-2.5 h-2.5 shrink-0" />
                {s.meta}
              </div>
            </div>
          );
        }
        if (s.kind === 'in') {
          return <CampaignFlowPreviewWaIn key={idx} text={s.text} meta={s.meta} />;
        }
        return (
          <CampaignFlowPreviewWaOut
            key={idx}
            text={s.text}
            stepLabel={s.stepLabel}
            time={time}
            showRead={idx === 0}
          />
        );
      })}
    </div>
  );
};
