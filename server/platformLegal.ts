import {
  formatCnpjDisplay,
  formatWhatsAppDisplay,
  type PlatformLegalInfo,
} from '../shared/platformLegal.js';

function env(key: string): string {
  return (process.env[key] || '').trim();
}

/** Normaliza WhatsApp BR para wa.me (55 + DDD + número). */
export function normalizeWhatsAppDigits(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}

export function getPlatformLegalInfo(): PlatformLegalInfo {
  const productName = env('PLATFORM_PRODUCT_NAME') || 'ZapMass';
  const legalName = env('PLATFORM_LEGAL_NAME');
  const tradeName = env('PLATFORM_TRADE_NAME') || legalName;
  const cnpjRaw = env('PLATFORM_CNPJ');
  const supportEmail = env('PLATFORM_SUPPORT_EMAIL') || env('SUGGESTION_NOTIFY_EMAIL');
  const waRaw = env('PLATFORM_SUPPORT_WHATSAPP');
  const waDigits = normalizeWhatsAppDigits(waRaw);

  const city = env('PLATFORM_CITY');
  const state = env('PLATFORM_STATE');
  const addressLine = env('PLATFORM_ADDRESS');
  const cep = env('PLATFORM_CEP');

  const operator =
    legalName && tradeName && legalName !== tradeName
      ? `${productName} é um produto da ${tradeName} (${legalName})`
      : legalName
        ? `${productName} é operado por ${legalName}`
        : productName;

  return {
    productName,
    legalName,
    tradeName,
    cnpj: cnpjRaw ? formatCnpjDisplay(cnpjRaw) : '',
    addressLine,
    city,
    state,
    cep,
    supportEmail,
    supportWhatsApp: waDigits,
    supportWhatsAppDisplay: waDigits ? formatWhatsAppDisplay(waDigits) : waRaw,
    operatorTagline: operator,
  };
}

export function hasPlatformSupportContact(info: PlatformLegalInfo): boolean {
  return Boolean(info.supportEmail || info.supportWhatsApp);
}
