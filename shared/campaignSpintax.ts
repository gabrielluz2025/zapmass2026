/** Bloco `{a|b|c}` — no disparo cada destinatário recebe uma opção (rodízio anti-spam). */

const SPINTAX_BLOCK_RE = /\{([^{}]+(?:\|[^{}]+)+)\}/g;

export function buildCampaignSpintax(options: string[]): string | null {
  const cleaned = options.map((s) => String(s || '').trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  if (cleaned.length === 1) return cleaned[0]!;
  const escaped = cleaned.map((o) => o.replace(/\|/g, '｜'));
  return `{${escaped.join('|')}}`;
}

export function resolveCampaignSpintax(text: string, rotationIndex: number): string {
  return text.replace(SPINTAX_BLOCK_RE, (_, inner: string) => {
    const parts = inner
      .split('|')
      .map((s) => s.replace(/｜/g, '|').trim())
      .filter(Boolean);
    if (parts.length === 0) return '';
    const idx = ((rotationIndex % parts.length) + parts.length) % parts.length;
    return parts[idx]!;
  });
}

/** Índice estável por telefone quando o índice da fila não está disponível (ex.: resposta automática). */
export function campaignRotationIndexFromPhone(phone: string): number {
  const digits = (phone || '').replace(/\D/g, '');
  let h = 0;
  for (let i = 0; i < digits.length; i++) {
    h = (h * 31 + digits.charCodeAt(i)) >>> 0;
  }
  return h;
}
