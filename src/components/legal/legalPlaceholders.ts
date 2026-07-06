import type { PlatformLegalInfo } from '../../../shared/platformLegal';

const LAST_UPDATED = '6 de julho de 2026';

export function buildLegalPlaceholders(info: PlatformLegalInfo | null): Record<string, string> {
  const productName = info?.productName || 'ZapMass';
  const legalName = info?.legalName || 'ZION SISTEMAS LTDA';
  const tradeName = info?.tradeName || 'ZION SISTEMAS';
  const cnpj = info?.cnpj || '27.118.225/0001-01';
  const addressParts = [
    info?.addressLine || 'Rua Eça de Queiroz, 667, Sala 01, Água Verde',
    info?.city && info?.state ? `${info.city} - ${info.state}` : 'Blumenau - SC',
    info?.cep ? `CEP ${info.cep}` : 'CEP 89037-400',
  ];
  const addressFull = addressParts.filter(Boolean).join(', ');
  const supportEmail = info?.supportEmail || 'zion.sistemasbnu@gmail.com';
  const waDisplay = info?.supportWhatsAppDisplay || '+55 (47) 98850-9311';
  const supportWhatsAppLine = info?.supportWhatsApp
    ? ` · WhatsApp: ${waDisplay}`
    : waDisplay
      ? ` · WhatsApp: ${waDisplay}`
      : '';

  let publicUrl = '';
  if (typeof window !== 'undefined') {
    try {
      publicUrl = window.location.origin;
    } catch {
      publicUrl = '';
    }
  }

  return {
    productName,
    legalName,
    tradeName,
    cnpj,
    addressFull,
    supportEmail,
    supportWhatsAppLine,
    supportWhatsAppDisplay: waDisplay,
    lastUpdated: LAST_UPDATED,
    publicUrl,
  };
}

export function applyLegalPlaceholders(template: string, info: PlatformLegalInfo | null): string {
  const map = buildLegalPlaceholders(info);
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => map[key] ?? '');
}
