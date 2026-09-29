/** Chave de mídia da campanha: etapa 0 = id da campanha; follow-up reply = sufixo. */
export function campaignMediaStorageKey(campaignId: string, replyStepIndex = 0): string {
  const id = String(campaignId || '').trim();
  if (!id) return '';
  return replyStepIndex <= 0 ? id : `${id}:reply-step:${replyStepIndex}`;
}

/** Foto enviada junto com a resposta de um gatilho (opção do menu). */
export function isReplyOptionMediaKey(campaignId: string, storageKey: string): boolean {
  const id = String(campaignId || '').trim();
  const key = String(storageKey || '').trim();
  if (!id || !key || key.includes('..') || key.length > 180) return false;
  return key.startsWith(`${id}:reply-opt:`);
}
