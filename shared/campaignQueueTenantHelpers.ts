/** Índice de etapa (0-based) a partir do payload do job BullMQ. */
export function queueJobStepIndex(data: {
  stageIndex?: number;
  multiStepContact?: { stepIndex?: number };
  nurtureStepIndex?: number;
}): number {
  if (data.multiStepContact != null && Number.isFinite(Number(data.multiStepContact.stepIndex))) {
    return Number(data.multiStepContact.stepIndex);
  }
  if (Number.isFinite(Number(data.stageIndex))) return Number(data.stageIndex);
  if (Number.isFinite(Number(data.nurtureStepIndex))) return Number(data.nurtureStepIndex);
  return 0;
}

/** Mascara telefone para exibição (mantém DDI + últimos 4). */
export function maskQueuePhone(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  const tail = digits.slice(-4);
  const head = digits.length > 8 ? digits.slice(0, 2) : '';
  return head ? `${head}…${tail}` : `…${tail}`;
}

export type CampaignQueueRemoveConfirmScope = 'campaign' | 'step' | 'channel' | 'jobs' | 'all';

export function buildQueueRemoveConfirmPhrase(scope: CampaignQueueRemoveConfirmScope, id?: string): string {
  const key = String(id || '').trim();
  switch (scope) {
    case 'campaign':
      return `LIMPAR CAMPANHA ${key}`;
    case 'step':
      return `LIMPAR ETAPA ${key}`;
    case 'channel':
      return `LIMPAR CANAL ${key}`;
    case 'jobs':
      return 'LIMPAR JOBS';
    case 'all':
      return 'LIMPAR MINHA FILA';
    default:
      return 'LIMPAR';
  }
}

export function parseQueueRemoveConfirm(
  body: { confirm?: unknown; scope?: unknown; scopeId?: unknown },
  expectedScope: CampaignQueueRemoveConfirmScope,
  scopeId?: string
): boolean {
  const expected = buildQueueRemoveConfirmPhrase(expectedScope, scopeId);
  return String(body.confirm || '').trim() === expected;
}
