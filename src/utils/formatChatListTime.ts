/** Converte timestamp Evolution (s ou ms) para Unix ms válido. */
export function normalizeEvolutionTimestampMs(raw: unknown, fallbackMs = 0): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallbackMs;
  return n > 1_000_000_000_000 ? Math.floor(n) : Math.floor(n * 1000);
}

/** Formata hora/data para lista de conversas (igual WhatsApp Web). */
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
