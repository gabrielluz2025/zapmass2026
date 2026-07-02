/** ID canônico de conversa 1:1 — sempre @s.whatsapp.net (Evolution / WhatsApp Web). */
export function buildCanonicalConversationId(connectionId: string, phoneDigits: string): string {
  const conn = String(connectionId || '').trim();
  const digits = String(phoneDigits || '').replace(/\D/g, '');
  if (!conn || digits.length < 8) return '';
  return `${conn}:${digits}@s.whatsapp.net`;
}

/** Normaliza qualquer formato legado (@c.us, só dígitos) para o ID canônico. */
export function normalizeConversationId(conversationId: string): string {
  const raw = String(conversationId || '').trim();
  const colon = raw.indexOf(':');
  if (colon < 0) return raw;
  const conn = raw.slice(0, colon);
  const chatPart = raw.slice(colon + 1);
  if (chatPart.startsWith('draft:')) return raw;
  const digits = chatPart.split('@')[0].replace(/\D/g, '');
  const canonical = buildCanonicalConversationId(conn, digits);
  return canonical || raw;
}
