import React, { useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Button, Modal } from '../ui';
import {
  WHATSAPP_META_CLOUD_GET_STARTED,
  WHATSAPP_META_POLICY,
  WHATSAPP_RISK_BULLETS,
  WHATSAPP_RISK_SHORT
} from '../../constants/whatsappLegal';

interface WhatsAppRiskAcceptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccepted: () => void;
}

export const WhatsAppRiskAcceptModal: React.FC<WhatsAppRiskAcceptModalProps> = ({
  isOpen,
  onClose,
  onAccepted
}) => {
  const [checked, setChecked] = useState(false);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Uso do WhatsApp e riscos"
      subtitle="Leitura obrigatoria antes de disparos e campanhas."
      icon={<AlertTriangle className="w-5 h-5 text-amber-500" />}
      size="md"
    >
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
          {WHATSAPP_RISK_SHORT}
        </p>
        <ul className="text-[12px] space-y-2 list-disc pl-4" style={{ color: 'var(--text-2)' }}>
          {WHATSAPP_RISK_BULLETS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          <a
            href={WHATSAPP_META_POLICY}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-emerald-600 hover:underline"
          >
            Politica comercial WhatsApp <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href={WHATSAPP_META_CLOUD_GET_STARTED}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-emerald-600 hover:underline"
          >
            Cloud API (Meta) <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <label className="flex items-start gap-3 cursor-pointer rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
          <input
            type="checkbox"
            className="mt-1 rounded border-gray-500"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span className="text-[12px] leading-snug" style={{ color: 'var(--text-1)' }}>
            Declaro que li e entendi os riscos, que sou responsavel pelo uso do WhatsApp, pelas listas e pelo cumprimento de leis aplicaveis (incluindo LGPD), e que a Meta pode banir numeros ou restringir contas. O fornecedor do ZapMass nao substitui assessoria juridica.
          </span>
        </label>
        <div className="flex flex-wrap gap-2 justify-end pt-1">
          <Button variant="secondary" type="button" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={!checked}
            onClick={() => {
              onAccepted();
              setChecked(false);
            }}
          >
            Aceitar e continuar
          </Button>
        </div>
      </div>
    </Modal>
  );
};
