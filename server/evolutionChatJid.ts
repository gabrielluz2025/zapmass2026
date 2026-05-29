/** Evolution v2 pode devolver só dígitos (sem `@`) em `id`/`remoteJid` — normaliza para JID WA. */
export function normalizeChatRemoteJid(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'object') {
    const row = raw as { _serialized?: string; user?: string; server?: string };
    if (row._serialized) return normalizeChatRemoteJid(row._serialized);
    if (row.user) {
      return normalizeChatRemoteJid(`${row.user}@${row.server || 's.whatsapp.net'}`);
    }
    return null;
  }
  const s = String(raw).trim();
  if (!s) return null;
  if (s.includes('@')) return s;
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 10) return `${digits}@s.whatsapp.net`;
  return null;
}

/** Extrai remoteJid de um item retornado por findChats (Evolution). */
export function chatRemoteJidFromFindChatsRow(chat: Record<string, unknown> | null | undefined): string | null {
  if (!chat) return null;
  const idRaw = chat.id;
  const candidates: unknown[] = [
    chat.remoteJid,
    chat.jid,
    (chat.key as { remoteJid?: unknown } | undefined)?.remoteJid,
    (chat.lastMessage as { key?: { remoteJid?: unknown } } | undefined)?.key?.remoteJid,
    typeof idRaw === 'string' ? idRaw : null,
    idRaw && typeof idRaw === 'object'
      ? (idRaw as { _serialized?: string; user?: string; server?: string })._serialized ||
          ((idRaw as { user?: string; server?: string }).user
            ? `${(idRaw as { user: string }).user}@${(idRaw as { server?: string }).server || 's.whatsapp.net'}`
            : null)
      : null,
  ];
  for (const c of candidates) {
    const jid = normalizeChatRemoteJid(c);
    if (jid) return jid;
  }
  return null;
}
