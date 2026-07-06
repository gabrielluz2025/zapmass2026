/** Identidade legal da plataforma (operador do ZapMass) — espelha server/platformLegal.ts */
export type PlatformLegalInfo = {
  productName: string;
  legalName: string;
  tradeName: string;
  cnpj: string;
  addressLine: string;
  city: string;
  state: string;
  cep: string;
  supportEmail: string;
  /** Apenas dígitos (ex.: 5547988509311) para wa.me */
  supportWhatsApp: string;
  supportWhatsAppDisplay: string;
  /** Texto curto para rodapé: "ZapMass é um produto da ZION SISTEMAS LTDA" */
  operatorTagline: string;
};

export function formatCnpjDisplay(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 14) return raw.trim();
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function whatsAppHref(digits: string): string {
  const d = digits.replace(/\D/g, '');
  return d ? `https://wa.me/${d}` : '';
}

export function formatWhatsAppDisplay(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) {
    return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  return digits;
}
