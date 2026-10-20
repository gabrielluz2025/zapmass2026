import { describe, expect, it } from 'vitest';
import {
  shouldFailOpenFullAccess,
  shouldShowOnboardingHardGate,
  type SubscriptionGateInput
} from './subscriptionGateLogic';

const base: SubscriptionGateInput = {
  enforce: true,
  userLoggedIn: true,
  isPlatformAdmin: false,
  isTeamMember: false,
  workspaceLoading: false,
  subscriptionLoading: false,
  subscriptionFetchFailed: false,
  subscription: null,
  optimisticTrialEndsAt: null
};

describe('shouldShowOnboardingHardGate', () => {
  it('não mostra gate enquanto assinatura carrega', () => {
    expect(
      shouldShowOnboardingHardGate({ ...base, subscriptionLoading: true })
    ).toBe(false);
  });

  it('não mostra gate após falha de fetch (estado desconhecido)', () => {
    expect(
      shouldShowOnboardingHardGate({ ...base, subscriptionFetchFailed: true })
    ).toBe(false);
  });

  it('mostra gate só quando enforce, sem doc e fetch ok', () => {
    expect(shouldShowOnboardingHardGate(base)).toBe(true);
    expect(
      shouldShowOnboardingHardGate({
        ...base,
        subscription: { status: 'active', provider: 'mercadopago', plan: 'monthly' }
      })
    ).toBe(false);
  });

  it('funcionário da equipe não vê gate de onboarding', () => {
    expect(shouldShowOnboardingHardGate({ ...base, isTeamMember: true })).toBe(false);
  });
});

describe('shouldFailOpenFullAccess', () => {
  it('libera acesso temporário se fetch falhou e não há doc local', () => {
    expect(
      shouldFailOpenFullAccess({
        enforce: true,
        userLoggedIn: true,
        isPlatformAdmin: false,
        subscriptionFetchFailed: true,
        hasSubscriptionDoc: false
      })
    ).toBe(true);
  });

  it('não fail-open se já há doc de assinatura em cache', () => {
    expect(
      shouldFailOpenFullAccess({
        enforce: true,
        userLoggedIn: true,
        isPlatformAdmin: false,
        subscriptionFetchFailed: true,
        hasSubscriptionDoc: true
      })
    ).toBe(false);
  });
});
