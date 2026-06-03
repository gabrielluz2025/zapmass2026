import type { ChatMessage } from '../../../types';

export function formatMsgTime(msg: ChatMessage): string {
  if (typeof msg.timestampMs === 'number' && msg.timestampMs > 0) {
    return new Date(msg.timestampMs).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  const raw = String(msg.timestamp || '').trim();
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
  }
  return '';
}

export function messageDayKey(msg: ChatMessage): string {
  const ms =
    typeof msg.timestampMs === 'number' && msg.timestampMs > 0
      ? msg.timestampMs
      : Date.parse(String(msg.timestamp || ''));
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function formatDayLabel(msg: ChatMessage): string {
  const ms =
    typeof msg.timestampMs === 'number' && msg.timestampMs > 0
      ? msg.timestampMs
      : Date.parse(String(msg.timestamp || ''));
  if (!Number.isFinite(ms) || ms <= 0) return 'Mensagens';
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Hoje';
  if (sameDay(d, yesterday)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
