/** Quantos envios de cada canal ficam quentes no Redis. O resto espera no Postgres/Redis até o anterior sair. */
export const CAMPAIGN_CHANNEL_WINDOW = 2;

export type WindowEntry<T> = { item: T; delayMs: number };

/**
 * Os dois primeiros de cada canal entram na fila (o primeiro na hora).
 * O restante fica guardado e só entra quando um envio daquele canal termina.
 */
export function splitCampaignDispatchWindow<T extends { connectionId?: string; replyFlowResponse?: boolean; nurtureFollowUp?: boolean }>(
  entries: Array<WindowEntry<T>>,
  depth = CAMPAIGN_CHANNEL_WINDOW,
  paceMs = 0
): { hot: Array<WindowEntry<T>>; held: Array<WindowEntry<T>> } {
  const limit = Math.max(1, depth);
  const pace = Math.max(0, Math.round(paceMs));
  const counts = new Map<string, number>();
  const hot: Array<WindowEntry<T>> = [];
  const held: Array<WindowEntry<T>> = [];
  for (const entry of entries) {
    if (entry.item.replyFlowResponse || entry.item.nurtureFollowUp) {
      hot.push(entry);
      continue;
    }
    const id = String(entry.item.connectionId || '').trim() || '_';
    const n = counts.get(id) || 0;
    if (n < limit) {
      hot.push({ item: entry.item, delayMs: n === 0 ? 0 : pace });
      counts.set(id, n + 1);
    } else {
      held.push(entry);
    }
  }
  return { hot, held };
}
