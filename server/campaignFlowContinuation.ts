/** Item de fila de campanha com campos mínimos para detectar continuação de fluxo. */
export type CampaignQueueFlowItem = {
  stageIndex?: number;
  replyFlowAfterSend?: unknown;
  /** Resposta automática do fluxo (menu, fallback ou follow-up) — mesma conversa. */
  replyFlowResponse?: boolean;
  multiStepContact?: { stepIndex: number };
};

/**
 * Etapas após resposta ou 2+ do mesmo fluxo não devem cair no limite de 24 h —
 * são continuação da mesma conversa, não novo disparo em massa.
 */
export function isCampaignFlowContinuation(item: CampaignQueueFlowItem): boolean {
  if (item.replyFlowAfterSend) return true;
  if (item.replyFlowResponse) return true;
  if (item.multiStepContact && item.multiStepContact.stepIndex > 0) return true;
  if (typeof item.stageIndex === 'number' && item.stageIndex > 0) return true;
  return false;
}

/** Variantes com/sem 9º dígito BR para casar contato na fila com webhook Evolution. */
export function phoneContactIdVariants(phone: string): string[] {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return [];
  const out = new Set<string>([digits]);
  if (digits.length === 13 && digits.startsWith('55') && digits.charAt(4) === '9') {
    out.add(digits.slice(0, 4) + digits.slice(5));
  } else if (digits.length === 12 && digits.startsWith('55')) {
    out.add(digits.slice(0, 4) + '9' + digits.slice(4));
  } else if (digits.length === 11 && digits.charAt(2) === '9') {
    out.add(digits.slice(0, 2) + digits.slice(3));
  } else if (digits.length === 10) {
    out.add(digits.slice(0, 2) + '9' + digits.slice(2));
  }
  return [...out];
}
