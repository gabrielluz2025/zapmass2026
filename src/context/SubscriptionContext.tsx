import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { firestoreTimeToMs } from '../utils/firestoreTime';
import { useAuth } from './AuthContext';
import { fetchSubscription } from '../services/subscriptionApi';
import { useWorkspace } from './WorkspaceContext';
import { useAppConfig } from './AppConfigContext';
import { formatTrialHoursLabel } from '../utils/trialCopy';
import { isPlatformAdminUser } from '../utils/adminAccess';
import { readBootstrapCache, writeBootstrapCache } from '../utils/bootstrapSessionCache';
import {
  shouldFailOpenFullAccess,
  shouldShowOnboardingHardGate
} from '../utils/subscriptionGateLogic';
import type { UserSubscription } from '../types';

interface SubscriptionContextValue {
  subscription: UserSubscription | null;
  loading: boolean;
  /** Falha ao buscar assinatura (rede/servidor) — não tratar como “sem plano”. */
  subscriptionFetchFailed: boolean;
  enforce: boolean;
  hasFullAccess: boolean;
  readOnlyMode: boolean;
  readOnlyMessage: string;
  needsOnboardingGate: boolean;
  applyTrialActivation: (trialEndsAtIso: string) => void;
  accessAllowed: boolean;
}

const SubscriptionContext = createContext<SubscriptionContextValue>({
  subscription: null,
  loading: true,
  enforce: false,
  hasFullAccess: true,
  readOnlyMode: false,
  readOnlyMessage: '',
  needsOnboardingGate: false,
  subscriptionFetchFailed: false,
  applyTrialActivation: () => {},
  accessAllowed: true
});

export const SubscriptionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { effectiveWorkspaceUid, loading: workspaceLoading, isTeamMember } = useWorkspace();
  const { config } = useAppConfig();
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscriptionFetchFailed, setSubscriptionFetchFailed] = useState(false);
  const [optimisticTrialEndsAt, setOptimisticTrialEndsAt] = useState<string | null>(null);

  const enforce = import.meta.env.VITE_ENFORCE_SUBSCRIPTION === 'true';

  const applyTrialActivation = useCallback((trialEndsAtIso: string) => {
    const iso = String(trialEndsAtIso || '').trim();
    if (!iso) return;
    setOptimisticTrialEndsAt(iso);
  }, []);

  const effectiveSubscription = useMemo((): UserSubscription | null => {
    if (subscription) return subscription;
    if (!optimisticTrialEndsAt) return null;
    const ms = Date.parse(optimisticTrialEndsAt);
    if (!Number.isFinite(ms) || ms <= Date.now()) return null;
    return {
      status: 'trialing',
      provider: 'none',
      plan: null,
      trialEndsAt: { seconds: Math.floor(ms / 1000) },
      freeTrialUsed: true,
      includedChannels: 1
    };
  }, [subscription, optimisticTrialEndsAt]);

  useEffect(() => {
    if (!user) {
      setSubscription(null);
      setSubscriptionFetchFailed(false);
      setLoading(false);
      return;
    }
    if (workspaceLoading) {
      setLoading(true);
      return;
    }
    let cancelled = false;
    const tenantUid = effectiveWorkspaceUid || user.uid;
    const cached = readBootstrapCache(tenantUid);
    if (cached?.subscription !== undefined) {
      setSubscription(cached.subscription);
      setLoading(false);
    }
    const load = async () => {
      try {
        const sub = await fetchSubscription();
        if (!cancelled) {
          setSubscription(sub);
          setSubscriptionFetchFailed(false);
          if (sub) setOptimisticTrialEndsAt(null);
          writeBootstrapCache(tenantUid, { subscription: sub });
        }
      } catch (e) {
        console.error('[SubscriptionContext]', e);
        if (!cancelled) setSubscriptionFetchFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (!cached) setLoading(true);
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user, effectiveWorkspaceUid, workspaceLoading]);

  const gateInput = useMemo(
    () => ({
      enforce,
      userLoggedIn: !!user,
      isPlatformAdmin: !!user && isPlatformAdminUser(user),
      isTeamMember,
      workspaceLoading,
      subscriptionLoading: loading,
      subscriptionFetchFailed,
      subscription: effectiveSubscription,
      optimisticTrialEndsAt
    }),
    [
      enforce,
      user,
      isTeamMember,
      workspaceLoading,
      loading,
      subscriptionFetchFailed,
      effectiveSubscription,
      optimisticTrialEndsAt
    ]
  );

  const hasFullAccess = useMemo(() => {
    if (!enforce) return true;
    if (!user) return false;
    if (isPlatformAdminUser(user)) return true;
    if (
      shouldFailOpenFullAccess({
        enforce,
        userLoggedIn: true,
        isPlatformAdmin: isPlatformAdminUser(user),
        subscriptionFetchFailed,
        hasSubscriptionDoc: !!effectiveSubscription
      })
    ) {
      return true;
    }
    if (!effectiveSubscription) return false;
    if (effectiveSubscription.blocked === true) return false;
    const now = Date.now();
    const manualEnd = firestoreTimeToMs(effectiveSubscription.manualAccessEndsAt);
    if (effectiveSubscription.manualGrant === true) {
      if (manualEnd == null) return true;
      return now < manualEnd;
    }
    const trialEnd = firestoreTimeToMs(effectiveSubscription.trialEndsAt);
    const accessEnd = firestoreTimeToMs(effectiveSubscription.accessEndsAt);

    if (effectiveSubscription.status === 'active') {
      if (accessEnd == null) return true;
      return now < accessEnd;
    }
    // Débito automático cancelado: o período já pago continua valendo (alinhado ao servidor).
    if (effectiveSubscription.status === 'canceled' && accessEnd != null) {
      return now < accessEnd;
    }
    if (effectiveSubscription.status === 'trialing' && trialEnd != null) {
      return now < trialEnd;
    }
    return false;
  }, [enforce, user, effectiveSubscription, subscriptionFetchFailed]);

  /** Falha de rede sem doc de plano: não trata como expirado (servidor continua a validar envios). */
  const subscriptionUnknown =
    subscriptionFetchFailed && !effectiveSubscription;

  const readOnlyMode =
    enforce && !!user && !hasFullAccess && !isPlatformAdminUser(user) && !subscriptionUnknown;

  const readOnlyMessage = useMemo(() => {
    if (!readOnlyMode) return '';
    const trialH = config?.trialHours ?? 1;
    const trialLabel = formatTrialHoursLabel(trialH);
    return `Seu ${trialLabel} de teste terminou ou o plano expirou. Renove em Minha assinatura para voltar a enviar.`;
  }, [readOnlyMode, config?.trialHours]);

  const needsOnboardingGate = shouldShowOnboardingHardGate(gateInput);

  const value = useMemo(
    () => ({
      subscription: effectiveSubscription,
      loading,
      subscriptionFetchFailed,
      enforce,
      hasFullAccess,
      readOnlyMode,
      readOnlyMessage,
      needsOnboardingGate,
      applyTrialActivation,
      accessAllowed: hasFullAccess
    }),
    [
      effectiveSubscription,
      loading,
      subscriptionFetchFailed,
      enforce,
      hasFullAccess,
      readOnlyMode,
      readOnlyMessage,
      needsOnboardingGate,
      applyTrialActivation
    ]
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
};

export const useSubscription = () => useContext(SubscriptionContext);
