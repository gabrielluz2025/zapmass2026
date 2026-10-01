import React from 'react';
import { Check, CheckCheck } from 'lucide-react';

type OutProps = {
  text: string;
  stepLabel?: string;
  time?: string;
  showRead?: boolean;
};

type InProps = {
  text: string;
  meta?: string;
};

/** Bolhas reutilizáveis na prévia de campanha (mesmo visual do editor cw-wa-bubble). */
export const CampaignFlowPreviewWaOut: React.FC<OutProps> = ({
  text,
  stepLabel,
  time,
  showRead
}) => (
  <div className="space-y-1 w-full">
    {stepLabel ? (
      <div className="flex justify-center">
        <span
          className="text-[9.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
          style={{
            background: 'rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.65)'
          }}
        >
          {stepLabel}
        </span>
      </div>
    ) : null}
    <div className="flex flex-col items-end w-full">
      <div className="cw-wa-bubble cw-wa-bubble--out max-w-[88%] text-[12.5px]">
        {text.trim() ? text : <span className="opacity-60 italic">(vazio)</span>}
        {time ? (
          <div className="text-[9.5px] mt-1 opacity-70 text-right flex items-center justify-end gap-0.5 font-mono">
            <span>{time}</span>
            {showRead ? (
              <CheckCheck className="w-3 h-3" style={{ color: '#53bdeb' }} />
            ) : (
              <Check className="w-3 h-3" />
            )}
          </div>
        ) : null}
      </div>
    </div>
  </div>
);

export const CampaignFlowPreviewWaIn: React.FC<InProps> = ({ text, meta }) => (
  <div className="space-y-0.5 w-full">
    {meta ? (
      <div className="flex justify-start pl-1">
        <span
          className="text-[9px] font-bold uppercase tracking-wide"
          style={{ color: 'rgba(255,255,255,0.35)' }}
        >
          {meta}
        </span>
      </div>
    ) : null}
    <div className="flex flex-col items-start w-full">
      <div className="cw-wa-bubble cw-wa-bubble--in max-w-[75%] text-[12.5px] font-semibold">{text}</div>
    </div>
  </div>
);
