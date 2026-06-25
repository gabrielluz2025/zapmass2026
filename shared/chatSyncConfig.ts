/** Sync completo da inbox (findChats + prefetch findMessages) ao conectar chip / full sync. */
export function isFullInboxSyncEnabled(): boolean {
  return !['0', 'false', 'no', 'off'].includes(
    String(process.env.WA_FULL_INBOX_SYNC ?? '1').trim().toLowerCase()
  );
}

/** Baileys/Evolution: baixar histórico completo do celular na conexão (settings.syncFullHistory). */
export function isEvolutionFullHistorySyncEnabled(): boolean {
  const raw = process.env.EVOLUTION_SYNC_FULL_HISTORY;
  if (raw != null && String(raw).trim() !== '') {
    return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
  }
  return isFullInboxSyncEnabled();
}

/** Mensagens prefetch por conversa “vazia” no sync Evolution (findMessages). */
export function evolutionSyncMsgPrefetch(): number {
  const def = isFullInboxSyncEnabled() ? 200 : 80;
  const raw = Number(process.env.EVOLUTION_SYNC_MSG_PREFETCH ?? def);
  if (!Number.isFinite(raw)) return def;
  return Math.max(50, Math.min(500, Math.floor(raw)));
}

/** Quantas conversas recentes recebem prefetch de histórico no sync. */
export function evolutionSyncSparseConvLimit(): number {
  const def = isFullInboxSyncEnabled() ? 120 : 40;
  const raw = Number(process.env.EVOLUTION_SYNC_SPARSE_CONV_LIMIT ?? def);
  if (!Number.isFinite(raw)) return def;
  return Math.max(10, Math.min(300, Math.floor(raw)));
}

/** Máximo de mensagens por conversa nos payloads socket (lista + delta). */
export function socketInboxMsgTailLimit(): number {
  const raw = Number(process.env.CHAT_SOCKET_MSG_TAIL ?? 25);
  if (!Number.isFinite(raw)) return 25;
  return Math.max(15, Math.min(80, Math.floor(raw)));
}
