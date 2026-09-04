/** Identidade estável de job de campanha — evita o mesmo contato ser enfileirado duas vezes. */

export function digitsForCampaignJobId(phone: string): string {
  return String(phone || '').replace(/\D/g, '');
}

export function isDuplicateBullmqJobError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || err || '');
  return /already exists|already in the queue|jobid.*exist/i.test(msg);
}

/**
 * JobId sem timestamp: o mesmo contato+etapa da campanha não entra de novo na fila
 * (BullMQ rejeita). Respostas de fluxo/nurture continuam com sufixo único.
 */
export function buildCampaignSendJobId(item: {
  campaignId?: string;
  to: string;
  stageIndex?: number;
  replyFlowResponse?: boolean;
  nurtureFollowUp?: boolean;
}): string {
  const cid = String(item.campaignId || 'direct').trim() || 'direct';
  const phone = digitsForCampaignJobId(item.to);
  const stageTag = item.stageIndex != null ? `s${item.stageIndex}` : 's0';
  if (item.replyFlowResponse || item.nurtureFollowUp) {
    return `${cid}__${phone}__${stageTag}__rf__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  return `${cid}__${phone}__${stageTag}`;
}
