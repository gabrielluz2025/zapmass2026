/**
 * Motor multi-etapas persistente para campanhas com trigger_type condicional.
 *
 * Lida com:
 *  - 'immediate' / 'delay'   → agenda próxima etapa com delay configurado
 *  - 'any_reply'             → seta status waiting_reply; aguarda resposta via webhook
 *  - 'conditional'           → ao receber resposta, avalia condição e direciona para branch
 *
 * Retrocompatível: campanhas sem stageConfigs continuam funcionando via BullMQ puro.
 */

import type { CampaignStageConfig } from '../src/types.js';
import {
  advanceContactToStep,
  bulkInitContactStates,
  findWaitingReplyStateForContact,
  getContactState,
  markContactCompleted,
  markContactFailed,
  markContactSkipped,
  markContactWaitingReply,
  recordContactReply,
} from './repositories/campaignContactStateRepository.js';
import { usePostgresCampaigns } from './campaignStore.js';
import { resolvePostgresTenantId } from './auth/firebaseUidMap.js';

// ─── Tipos exportados ────────────────────────────────────────────────────────

export interface MultiStepEnqueueCallback {
  (params: {
    contactId: string;
    stepIndex: number;
    message: string;
    connectionId: string;
    campaignId: string;
    ownerUid?: string;
    delayMs: number;
    stageConfig: CampaignStageConfig;
  }): Promise<void>;
}

export interface MultiStepEngineCallbacks {
  enqueue: MultiStepEnqueueCallback;
  onLog: (message: string, payload?: Record<string, unknown>) => void;
  resolveConnectionId: (contactIndex: number) => string;
  resolveVars: (contactId: string) => Record<string, string>;
  applyVars: (template: string, contactId: string, vars: Record<string, string>) => string;
  getDispatchDelayMs: () => number;
  publishEvent: (ownerUid: string | undefined, event: string, data: unknown) => void;
}

// ─── Avalia condição de trigger ──────────────────────────────────────────────

function evaluateTriggerCondition(
  condition: CampaignStageConfig['trigger_condition'],
  replyText: string
): boolean {
  if (!condition) return true;
  const text = replyText.toLowerCase().trim();
  if (condition.contains) {
    return text.includes(condition.contains.toLowerCase());
  }
  if (condition.regex) {
    try {
      return new RegExp(condition.regex, 'i').test(replyText);
    } catch {
      return false;
    }
  }
  return true;
}

// ─── Inicialização do motor ──────────────────────────────────────────────────

/**
 * Cria registros campaign_contact_state para cada contato ao iniciar campanha
 * com stageConfigs configurado.
 */
export async function initMultiStepContactStates(
  tenantId: string,
  campaignId: string,
  contactIds: string[]
): Promise<void> {
  if (!usePostgresCampaigns()) return;
  await bulkInitContactStates(tenantId, campaignId, contactIds);
}

// ─── Conclusão de uma etapa ──────────────────────────────────────────────────

/**
 * Chamado após o worker BullMQ completar o envio de uma etapa.
 * Decide o que fazer na etapa seguinte conforme trigger_type.
 */
export async function onStepCompleted(params: {
  campaignId: string;
  tenantId: string;
  contactId: string;
  completedStepIndex: number;
  stageConfigs: CampaignStageConfig[];
  connectionId: string;
  callbacks: MultiStepEngineCallbacks;
  ownerUid?: string;
}): Promise<void> {
  if (!usePostgresCampaigns()) return;

  const {
    campaignId,
    tenantId,
    contactId,
    completedStepIndex,
    stageConfigs,
    connectionId,
    callbacks,
    ownerUid,
  } = params;

  const completedStage = stageConfigs[completedStepIndex];
  if (!completedStage) return;

  const nextIndex = completedStepIndex + 1;

  // Último step: marcar completo
  if (nextIndex >= stageConfigs.length) {
    await markContactCompleted(campaignId, contactId);
    callbacks.onLog('Contato concluiu todas as etapas da campanha', {
      campaignId,
      contactId,
      totalSteps: stageConfigs.length,
    });
    return;
  }

  const nextStage = stageConfigs[nextIndex];
  const triggerType = completedStage.trigger_type || 'delay';

  if (triggerType === 'any_reply' || triggerType === 'conditional') {
    // Aguarda resposta do contato antes de avançar
    await markContactWaitingReply(campaignId, contactId, completedStepIndex);
    callbacks.onLog('Contato aguardando resposta para avançar etapa', {
      campaignId,
      contactId,
      currentStep: completedStepIndex + 1,
      totalSteps: stageConfigs.length,
      timeoutHours: completedStage.timeout_hours,
    });

    // Agenda timeout se configurado
    if (completedStage.timeout_hours && completedStage.timeout_hours > 0) {
      const timeoutMs = completedStage.timeout_hours * 3600 * 1000;
      void scheduleTimeoutCheck(
        campaignId,
        tenantId,
        contactId,
        completedStepIndex,
        completedStage,
        stageConfigs,
        connectionId,
        callbacks,
        ownerUid,
        timeoutMs
      );
    }
    return;
  }

  // 'immediate' ou 'delay': agendar próxima etapa
  const delayMs =
    triggerType === 'immediate' ? 0 : callbacks.getDispatchDelayMs();

  const vars = callbacks.resolveVars(contactId);
  const message = callbacks.applyVars(nextStage.body, contactId, vars);

  await advanceContactToStep(campaignId, contactId, nextIndex, 'waiting_delay');

  await callbacks.enqueue({
    contactId,
    stepIndex: nextIndex,
    message,
    connectionId,
    campaignId,
    ownerUid,
    delayMs,
    stageConfig: nextStage,
  });

  callbacks.onLog('Próxima etapa agendada automaticamente', {
    campaignId,
    contactId,
    fromStep: completedStepIndex + 1,
    toStep: nextIndex + 1,
    delayMs,
    triggerType,
  });
}

// ─── Resposta do contato avança o fluxo ─────────────────────────────────────

/**
 * Chamado quando uma mensagem de entrada do contato é recebida.
 * Se o contato estiver em waiting_reply para uma campanha ativa,
 * avança para a próxima etapa conforme trigger_type e condição.
 */
export async function onContactReply(params: {
  tenantId: string;
  contactId: string;
  replyText: string;
  stageConfigsResolver: (campaignId: string) => CampaignStageConfig[] | undefined;
  connectionId: string;
  callbacks: MultiStepEngineCallbacks;
  ownerUid?: string;
}): Promise<boolean> {
  if (!usePostgresCampaigns()) return false;

  const { tenantId, contactId, replyText, stageConfigsResolver, connectionId, callbacks, ownerUid } =
    params;

  const pgTenantId = resolvePostgresTenantId(tenantId);
  const state = await findWaitingReplyStateForContact(pgTenantId, contactId);
  if (!state) return false;

  const { campaign_id: campaignId, current_step_index: currentStepIndex } = state;

  // Grava a resposta
  const updated = await recordContactReply(campaignId, contactId, replyText);
  if (!updated) return false;

  const stageConfigs = stageConfigsResolver(campaignId);
  if (!stageConfigs || stageConfigs.length === 0) return false;

  const currentStage = stageConfigs[currentStepIndex];
  if (!currentStage) return false;

  const triggerType = currentStage.trigger_type || 'any_reply';

  callbacks.onLog('Resposta do contato recebida no motor multi-etapas', {
    campaignId,
    contactId,
    currentStep: currentStepIndex + 1,
    replyPreview: replyText.slice(0, 80),
    triggerType,
  });

  // Determina o próximo step
  let nextIndex = currentStepIndex + 1;

  if (triggerType === 'conditional') {
    const conditionMatches = evaluateTriggerCondition(
      currentStage.trigger_condition,
      replyText
    );
    if (conditionMatches && currentStage.next_step_on_match != null) {
      nextIndex = currentStage.next_step_on_match;
    } else if (!conditionMatches && currentStage.next_step_on_no_match != null) {
      nextIndex = currentStage.next_step_on_no_match;
    }
    callbacks.onLog('Avaliação condicional da resposta', {
      campaignId,
      contactId,
      conditionMatches,
      nextStep: nextIndex + 1,
    });
  }

  // Fora de bounds → completar
  if (nextIndex >= stageConfigs.length) {
    await markContactCompleted(campaignId, contactId);
    callbacks.onLog('Contato concluiu fluxo após resposta', {
      campaignId,
      contactId,
      totalSteps: stageConfigs.length,
    });
    return true;
  }

  const nextStage = stageConfigs[nextIndex];
  const vars = callbacks.resolveVars(contactId);
  const message = callbacks.applyVars(nextStage.body, contactId, vars);

  await advanceContactToStep(campaignId, contactId, nextIndex, 'waiting_delay', new Date());

  await callbacks.enqueue({
    contactId,
    stepIndex: nextIndex,
    message,
    connectionId,
    campaignId,
    ownerUid,
    delayMs: 0,
    stageConfig: nextStage,
  });

  callbacks.onLog('Próxima etapa enfileirada após resposta do contato', {
    campaignId,
    contactId,
    fromStep: currentStepIndex + 1,
    toStep: nextIndex + 1,
  });

  callbacks.publishEvent(ownerUid, 'campaign:contact-advanced', {
    campaignId,
    contactId,
    fromStep: currentStepIndex,
    toStep: nextIndex,
  });

  return true;
}

// ─── Falha definitiva ────────────────────────────────────────────────────────

export async function updateContactStateOnFailure(
  campaignId: string,
  contactId: string,
  errorMessage: string
): Promise<void> {
  if (!usePostgresCampaigns()) return;
  try {
    await markContactFailed(campaignId, contactId, errorMessage);
  } catch (e) {
    // Silencioso: o motor persistente é best-effort.
  }
}

// ─── Timeout de waiting_reply ────────────────────────────────────────────────

async function scheduleTimeoutCheck(
  campaignId: string,
  tenantId: string,
  contactId: string,
  stepIndex: number,
  stage: CampaignStageConfig,
  stageConfigs: CampaignStageConfig[],
  connectionId: string,
  callbacks: MultiStepEngineCallbacks,
  ownerUid: string | undefined,
  timeoutMs: number
): Promise<void> {
  await new Promise((r) => setTimeout(r, timeoutMs));

  const current = await getContactState(campaignId, contactId);
  if (!current || current.status !== 'waiting_reply') return;
  if (current.current_step_index !== stepIndex) return;

  const action = stage.timeout_action || 'skip';
  callbacks.onLog('Timeout de waiting_reply expirou', {
    campaignId,
    contactId,
    step: stepIndex + 1,
    action,
    timeoutHours: stage.timeout_hours,
  });

  if (action === 'complete') {
    await markContactCompleted(campaignId, contactId);
    return;
  }

  if (action === 'skip') {
    await markContactSkipped(campaignId, contactId);
    return;
  }

  // action pode ser um índice de step (como string)
  const targetIndex = parseInt(String(action), 10);
  if (!isNaN(targetIndex) && targetIndex >= 0 && targetIndex < stageConfigs.length) {
    const targetStage = stageConfigs[targetIndex];
    const vars = callbacks.resolveVars(contactId);
    const message = callbacks.applyVars(targetStage.body, contactId, vars);
    await advanceContactToStep(campaignId, contactId, targetIndex, 'waiting_delay');
    await callbacks.enqueue({
      contactId,
      stepIndex: targetIndex,
      message,
      connectionId,
      campaignId,
      ownerUid,
      delayMs: 0,
      stageConfig: targetStage,
    });
    return;
  }

  await markContactSkipped(campaignId, contactId);
}
