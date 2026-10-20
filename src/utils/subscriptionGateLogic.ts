import type { UserSubscription } from '../types';

export type SubscriptionGateInput = {
  enforce: boolean;
  userLoggedIn: boolean;
  isPlatformAdmin: boolean;
  isTeamMember: boolean;
  workspaceLoading: boolean;
  subscriptionLoading: boolean;
  subscriptionFetchFailed: boolean;
  subscription: UserSubscription | null;
  optimisticTrialEndsAt: string | null;
};

/** Documento de assinatura ausente após fetch bem-sucedido (não confundir com erro de rede). */
export function isSubscriptionConfirmedEmpty(input: SubscriptionGateInput): boolean {
  if (input.subscriptionLoading || input.subscriptionFetchFailed) return false;
  if (input.subscription) return false;
  if (input.optimisticTrialEndsAt) return false;
  return true;
}

/**
 * Hard gate de onboarding (trial / Pro) — só após assinatura carregada com sucesso e sem doc.
 */
export function shouldShowOnboardingHardGate(input: SubscriptionGateInput): boolean {
  if (!input.enforce || !input.userLoggedIn || input.isPlatformAdmin || input.isTeamMember) return false;
  if (input.workspaceLoading || input.subscriptionLoading) return false;
  if (input.subscriptionFetchFailed) return false;
  if (input.optimisticTrialEndsAt) return false;
  return !input.subscription;
}

/**
 * Enquanto a assinatura não pôde ser verificada, não restringir acesso (evita gate falso para quem paga).
 */
export function shouldFailOpenFullAccess(input: {
  enforce: boolean;
  userLoggedIn: boolean;
  isPlatformAdmin: boolean;
  subscriptionFetchFailed: boolean;
  hasSubscriptionDoc: boolean;
}): boolean {
  if (!input.enforce || !input.userLoggedIn || input.isPlatformAdmin) return false;
  if (!input.subscriptionFetchFailed) return false;
  return !input.hasSubscriptionDoc;
}
