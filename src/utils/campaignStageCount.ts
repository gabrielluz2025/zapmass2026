import type { Campaign } from '../types';

/** Campanha cujas etapas 2+ dependem de resposta (fila inicial = 1 envio por contato). */
export function isConversationalMultiStepCampaign(
  c: Pick<Campaign, 'replyFlow' | 'stageConfigs'> | undefined
): boolean {
  if (!c) return false;
  if (c.replyFlow?.enabled && (c.replyFlow.steps?.length ?? 0) > 1) return true;
  const stages = c.stageConfigs ?? [];
  if (stages.length <= 1) return false;
  return stages.some(
    (s, i) =>
      i < stages.length - 1 &&
      (s.trigger_type === 'any_reply' || s.trigger_type === 'conditional')
  );
}

/**
 * Número de etapas de mensagem planejadas na campanha (1..N).
 * Prioriza fluxo por respostas; senão body[] de etapas; senão uma mensagem única.
 */
export function getCampaignStageTotal(
  c: Pick<Campaign, 'message' | 'messageStages' | 'replyFlow'> | undefined
): number {
  if (!c) return 1;
  const steps = c.replyFlow?.enabled ? c.replyFlow.steps : undefined;
  if (Array.isArray(steps) && steps.length > 0) return steps.length;
  const stages = c.messageStages?.map((s) => String(s || '').trim()).filter(Boolean) ?? [];
  if (stages.length > 0) return stages.length;
  if (String(c.message || '').trim().length > 0) return 1;
  return 1;
}

/**
 * Etapas efectivas para métricas: metadata da campanha ou inferida dos contadores
 * (cada envio incrementa success/fail — se houver mais envios que contactos×etapas-metadata,
 * usa-se o mínimo inferido para o denominador não ficar baixo demais).
 */
export function resolveCampaignEffectiveStageCount(
  c:
    | Pick<Campaign, 'totalContacts' | 'message' | 'messageStages' | 'replyFlow' | 'successCount' | 'failedCount'>
    | undefined
): number {
  if (!c) return 1;
  const meta = Math.max(1, getCampaignStageTotal(c));
  const contacts = Math.max(0, Math.floor(Number(c.totalContacts) || 0));
  if (contacts <= 0) return meta;
  const done =
    Math.max(0, Math.floor(Number(c.successCount) || 0)) +
    Math.max(0, Math.floor(Number(c.failedCount) || 0));
  if (done <= 0) return meta;
  const inferred = Math.ceil(done / contacts);
  return Math.max(meta, inferred);
}
