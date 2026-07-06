import React from 'react';
import { Building2, Mail, MessageCircle } from 'lucide-react';
import type { PlatformLegalInfo } from '../../../shared/platformLegal';
import { whatsAppHref } from '../../../shared/platformLegal';
import { Button, Card } from '../ui';

type Props = {
  info: PlatformLegalInfo;
  /** Abre o modal de sugestão in-app (botão da barra). */
  onOpenSuggestion?: () => void;
  compact?: boolean;
};

export const PlatformSupportCard: React.FC<Props> = ({ info, onOpenSuggestion, compact }) => {
  const waLink = whatsAppHref(info.supportWhatsApp);
  const hasLegal = Boolean(info.legalName || info.cnpj);
  const hasContact = Boolean(info.supportEmail || waLink);

  if (!hasLegal && !hasContact) return null;

  const addressParts = [info.addressLine, info.city && info.state ? `${info.city} - ${info.state}` : info.city, info.cep]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card className={compact ? 'p-4 space-y-3' : 'p-6 space-y-4'}>
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'rgba(16,185,129,0.12)' }}
        >
          <Building2 className="w-5 h-5" style={{ color: 'var(--brand-600)' }} />
        </div>
        <div>
          <h2 className="ui-title text-[15px]">Suporte {info.productName}</h2>
          <p className="ui-subtitle text-[12.5px] mt-1">
            Fale com a equipe responsável pela plataforma — dúvidas, plano ou problemas técnicos.
          </p>
        </div>
      </div>

      {hasLegal ? (
        <div className="text-[12.5px] leading-relaxed space-y-1" style={{ color: 'var(--text-2)' }}>
          {info.tradeName ? (
            <p>
              <strong style={{ color: 'var(--text-1)' }}>{info.tradeName}</strong>
              {info.legalName && info.legalName !== info.tradeName ? (
                <span className="block text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {info.legalName}
                </span>
              ) : null}
            </p>
          ) : null}
          {info.cnpj ? <p>CNPJ {info.cnpj}</p> : null}
          {addressParts ? <p>{addressParts}</p> : null}
          {info.operatorTagline ? (
            <p className="text-[11px] pt-1" style={{ color: 'var(--text-3)' }}>
              {info.operatorTagline}
            </p>
          ) : null}
        </div>
      ) : null}

      {hasContact ? (
        <div className="flex flex-wrap gap-2">
          {info.supportEmail ? (
            <a
              href={`mailto:${info.supportEmail}?subject=${encodeURIComponent(`Suporte ${info.productName}`)}`}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold border transition-colors hover:opacity-90"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-1)', background: 'var(--surface-2)' }}
            >
              <Mail className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
              {info.supportEmail}
            </a>
          ) : null}
          {waLink ? (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold border transition-colors hover:opacity-90"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-1)', background: 'var(--surface-2)' }}
            >
              <MessageCircle className="w-4 h-4" style={{ color: '#25D366' }} />
              WhatsApp {info.supportWhatsAppDisplay || info.supportWhatsApp}
            </a>
          ) : null}
          {onOpenSuggestion ? (
            <Button variant="secondary" size="sm" type="button" onClick={onOpenSuggestion}>
              Enviar mensagem no app
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
};
