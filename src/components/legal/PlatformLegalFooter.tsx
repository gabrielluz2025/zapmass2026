import React from 'react';
import { usePlatformInfo } from '../../hooks/usePlatformInfo';
import { whatsAppHref } from '../../../shared/platformLegal';

/** Rodapé legal na landing de login (operador + CNPJ + contato). */
export const PlatformLegalFooter: React.FC<{ textColor?: string; mutedColor?: string }> = ({
  textColor = 'inherit',
  mutedColor = 'inherit',
}) => {
  const { info } = usePlatformInfo();
  if (!info) return null;

  const wa = whatsAppHref(info.supportWhatsApp);
  const year = new Date().getFullYear();
  const line1 = info.legalName
    ? `© ${year} ${info.tradeName || info.legalName}${info.cnpj ? ` · CNPJ ${info.cnpj}` : ''}`
    : `© ${year} ${info.productName}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5, color: mutedColor }}>
      <span style={{ color: textColor }}>{line1}</span>
      {info.operatorTagline && info.legalName ? (
        <span style={{ fontSize: 10.5, opacity: 0.85 }}>{info.operatorTagline}</span>
      ) : null}
      {(info.supportEmail || wa) && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11 }}>
          {info.supportEmail ? (
            <a href={`mailto:${info.supportEmail}`} style={{ color: mutedColor, textDecoration: 'underline' }}>
              {info.supportEmail}
            </a>
          ) : null}
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" style={{ color: mutedColor, textDecoration: 'underline' }}>
              WhatsApp {info.supportWhatsAppDisplay}
            </a>
          ) : null}
        </span>
      )}
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 10.5, opacity: 0.9 }}>
        <a href="/termos" style={{ color: mutedColor, textDecoration: 'underline' }}>
          Termos de Uso
        </a>
        <a href="/privacidade" style={{ color: mutedColor, textDecoration: 'underline' }}>
          Política de Privacidade
        </a>
      </span>
    </div>
  );
};
