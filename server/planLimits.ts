/**
 * planLimits.ts
 * Limites técnicos por tier de plano.
 * Os tiers são: 'starter' | 'pro' | 'enterprise' | null (sem plano = defaults conservadores).
 *
 * Como o campo `planTier` ainda não é exigido na assinatura, o sistema usa
 * `includedChannels` e `manualGrant` como proxy:
 *   - manualGrant / includedChannels >= 10  → enterprise
 *   - includedChannels >= 5                 → pro
 *   - qualquer ativo com <= 2 chips         → starter
 *   - sem assinatura / trial               → starter (limites mais restritivos)
 */

import type { UserSubscriptionDoc } from './subscriptionStore.js';

export type PlanTier = 'starter' | 'pro' | 'enterprise';

export interface PlanLimits {
  /** Máximo de campanhas ativas simultâneas por usuário. */
  maxConcurrentCampaigns: number;
  /** Máximo de contatos em uma lista de campanha. */
  maxContactsPerCampaign: number;
  /** Máximo de chips (canais WhatsApp). Alinhado com connectionLimitPolicy.ts */
  maxChannels: number;
  /** Máximo de etapas em fluxo de resposta. */
  maxReplyFlowSteps: number;
  /** Máximo de opções no bot de atendimento automático. */
  maxBotMenuOptions: number;
  /** Máximo de itens FAQ no bot. */
  maxBotFaqItems: number;
  /** Nome legível do plano. */
  tierLabel: string;
}

const LIMITS: Record<PlanTier, PlanLimits> = {
  starter: {
    maxConcurrentCampaigns: 1,
    maxContactsPerCampaign: 5_000,
    maxChannels: 2,
    maxReplyFlowSteps: 3,
    maxBotMenuOptions: 5,
    maxBotFaqItems: 10,
    tierLabel: 'Starter',
  },
  pro: {
    maxConcurrentCampaigns: 3,
    maxContactsPerCampaign: 30_000,
    maxChannels: 5,
    maxReplyFlowSteps: 10,
    maxBotMenuOptions: 10,
    maxBotFaqItems: 20,
    tierLabel: 'Pro',
  },
  enterprise: {
    maxConcurrentCampaigns: 99,
    maxContactsPerCampaign: 999_999,
    maxChannels: 99,
    maxReplyFlowSteps: 50,
    maxBotMenuOptions: 20,
    maxBotFaqItems: 30,
    tierLabel: 'Enterprise',
  },
};

/**
 * Infere o tier a partir do documento de assinatura.
 * Extende futuramente para ler `sub.planTier` quando o campo existir.
 */
export function inferPlanTier(sub: UserSubscriptionDoc | null | undefined): PlanTier {
  if (!sub) return 'starter';
  if (sub.manualGrant === true) return 'enterprise';
  const channels = Math.floor(Number(sub.includedChannels) || 0);
  if (channels >= 10) return 'enterprise';
  if (channels >= 5) return 'pro';
  return 'starter';
}

export function getPlanLimits(tier: PlanTier): PlanLimits {
  return LIMITS[tier];
}

export function getPlanLimitsForSub(sub: UserSubscriptionDoc | null | undefined): PlanLimits {
  return getPlanLimits(inferPlanTier(sub));
}
