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

/** Converte timestamp Evolution (s ou ms) para Unix ms válido. */
export function normalizeEvolutionTimestampMs(raw: unknown, fallbackMs = 0): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallbackMs;
  return n > 1_000_000_000_000 ? Math.floor(n) : Math.floor(n * 1000);
}

/** Melhor timestamp disponível numa linha de findChats. */
export function resolveChatRowTimestampMs(
  chat: Record<string, unknown> | null | undefined,
  fallbackMs = Date.now()
): number {
  if (!chat) return fallbackMs;
  for (const key of ['conversationTimestamp', 'updatedAt', 't', 'lastMsgTimestamp', 'timestamp']) {
    const ms = normalizeEvolutionTimestampMs(chat[key], 0);
    if (ms > 0) return ms;
  }
  const lastMsg = chat.lastMessage as Record<string, unknown> | undefined;
  if (lastMsg) {
    const fromMsg = normalizeEvolutionTimestampMs(
      lastMsg.messageTimestamp ?? lastMsg.timestamp ?? (lastMsg as { t?: unknown }).t,
      0
    );
    if (fromMsg > 0) return fromMsg;
  }
  return fallbackMs;
}

/** JIDs inválidos ou placeholders (0, curto demais) — não viram conversa 1:1. */
export function isGarbagePersonChatJid(remoteJid: string): boolean {
  const jid = String(remoteJid || '').trim();
  if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us')) return true;
  if (jid.endsWith('@lid')) return false;
  const userPart = jid.split('@')[0] || '';
  const digits = userPart.replace(/\D/g, '');
  if (!digits || digits === '0') return true;
  return digits.length < 8;
}

/** Formata hora/data para lista de conversas (evita "Invalid Date"). */
export function formatChatListTime(tsMs: number): string {
  const ms = normalizeEvolutionTimestampMs(tsMs, 0);
  if (ms <= 0) return '';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isToday) {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
