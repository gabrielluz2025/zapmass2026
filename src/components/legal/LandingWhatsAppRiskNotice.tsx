import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import {
  WHATSAPP_META_CLOUD_OVERVIEW,
  WHATSAPP_META_POLICY,
  WHATSAPP_RISK_BULLETS,
  WHATSAPP_RISK_SHORT
} from '../../constants/whatsappLegal';

export const LandingWhatsAppRiskNotice: React.FC = () => {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ borderColor: 'rgba(245, 158, 11, 0.35)', background: 'rgba(245, 158, 11, 0.06)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-black/5"
      >
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
            Risco de banimento, LGPD e API oficial
          </p>
          <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: 'var(--text-3)' }}>
            Quem assume o risco da operacao e o cliente. Toque para ver detalhes e links da Meta.
          </p>
        </div>
        {open ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-0 space-y-3 border-t" style={{ borderColor: 'rgba(245, 158, 11, 0.2)' }}>
          <p className="text-[12.5px] leading-relaxed pt-3" style={{ color: 'var(--text-2)' }}>
            {WHATSAPP_RISK_SHORT}
          </p>
          <ul className="text-[11.5px] space-y-1.5 list-disc pl-4" style={{ color: 'var(--text-2)' }}>
            {WHATSAPP_RISK_BULLETS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold">
            <a href={WHATSAPP_META_POLICY} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline inline-flex items-center gap-1">
              Termos Meta / WhatsApp <ExternalLink className="w-3 h-3" />
            </a>
            <a href={WHATSAPP_META_CLOUD_OVERVIEW} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline inline-flex items-center gap-1">
              API oficial (visao geral) <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
};
