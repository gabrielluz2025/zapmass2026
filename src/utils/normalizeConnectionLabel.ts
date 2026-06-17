/**
 * Normaliza nomes de chips WhatsApp para comparação (inclui Unicode estilizado 𝙿𝚊𝚝𝚛í𝚌𝚒𝚊 → patricia).
 */
export function normalizeConnectionLabel(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s@._-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}
