/** Ajusta total/processado quando contatos são ignorados no enqueue (ex.: limite 24 h). */

export type CampaignRuntimeEnqueueAdjust = {
  total: number;
  processed: number;
  skipCountAdd: number;
};

/**
 * Contatos bloqueados por frequency cap no start não geram job BullMQ — precisam
 * contar como "processados (skip)" para não ficar RUNNING com processed < total.
 * `skippedSettled` não entra aqui: já está em `seededProcessed` do PG.
 */
export function adjustCampaignRuntimeForEnqueue(params: {
  seededProcessed: number;
  pendingEnqueueLength: number;
  skippedFrequencyCap: number;
}): CampaignRuntimeEnqueueAdjust {
  const seededProcessed = Math.max(0, params.seededProcessed);
  const pendingEnqueueLength = Math.max(0, params.pendingEnqueueLength);
  const skipCountAdd = Math.max(0, params.skippedFrequencyCap);
  const total = seededProcessed + pendingEnqueueLength + skipCountAdd;
  const processed = seededProcessed + skipCountAdd;
  return { total, processed, skipCountAdd };
}
