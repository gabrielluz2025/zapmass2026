/** Chave de mídia da campanha: etapa 0 = id da campanha; follow-up reply = sufixo. */
export function campaignMediaStorageKey(campaignId: string, replyStepIndex = 0): string {
  const id = String(campaignId || '').trim();
  if (!id) return '';
  return replyStepIndex <= 0 ? id : `${id}:reply-step:${replyStepIndex}`;
}
