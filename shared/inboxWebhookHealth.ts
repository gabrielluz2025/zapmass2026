/** Saúde do pipeline webhook → inbox (Evolution Go). */

export type InboxWebhookHealthStatus = 'n/a' | 'ok' | 'waiting' | 'stale';

export type InboxWebhookHealthPayload = {
  /** evolution-go | evolution-api */
  engine: string;
  openChips: number;
  /** ISO — último MESSAGES_UPSERT / HistorySync em qualquer chip do tenant */
  lastInboxWebhookAt: string | null;
  /** ISO — qualquer webhook (inclui CONNECTION_UPDATE) no tenant */
  lastAnyWebhookAt: string | null;
  status: InboxWebhookHealthStatus;
  /** Chips open sem evento de inbox dentro do limite (diagnóstico) */
  staleConnectionIds?: string[];
};

export function defaultInboxWebhookHealth(engine: string): InboxWebhookHealthPayload {
  return {
    engine,
    openChips: 0,
    lastInboxWebhookAt: null,
    lastAnyWebhookAt: null,
    status: engine === 'evolution-go' ? 'waiting' : 'n/a',
  };
}
