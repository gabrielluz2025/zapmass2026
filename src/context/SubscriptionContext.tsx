import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { firestoreTimeToMs } from '../utils/firestoreTime';
import { useAuth } from './AuthContext';
import { fetchSubscription } from '../services/subscriptionApi';
import { useWorkspace } from './WorkspaceContext';
import { useAppConfig } from './AppConfigContext';
import { formatTrialHoursLabel } from '../utils/trialCopy';
import { isPlatformAdminUser } from '../utils/adminAccess';
import type { UserSubscription } from '../types';

interface SubscriptionContextValue {
  subscription: UserSubscription | null;
  loading: boolean;
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
  applyTrialActivation: () => {},
  accessAllowed: true
});

export const SubscriptionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { effectiveWorkspaceUid, loading: workspaceLoading } = useWorkspace();
  const { config } = useAppConfig();
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [loading, setLoading] = useState(true);
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
      setLoading(false);
      return;
    }
    if (workspaceLoading) {
      setLoading(true);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const sub = await fetchSubscription();
        if (!cancelled) {
          setSubscription(sub);
          if (sub) setOptimisticTrialEndsAt(null);
        }
      } catch (e) {
        console.error('[SubscriptionContext]', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user, effectiveWorkspaceUid, workspaceLoading]);

  const hasFullAccess = useMemo(() => {
    if (!enforce) return true;
    if (!user) return false;
    if (isPlatformAdminUser(user)) return true;
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
    if (effectiveSubscription.status === 'trialing' && trialEnd != null) {
      return now < trialEnd;
    }
    return false;
  }, [enforce, user, effectiveSubscription]);

  const readOnlyMode = enforce && !!user && !hasFullAccess && !isPlatformAdminUser(user);

  const readOnlyMessage = useMemo(() => {
    if (!readOnlyMode) return '';
    const trialH = config?.trialHours ?? 1;
    const trialLabel = formatTrialHoursLabel(trialH);
    return `Seu ${trialLabel} de teste terminou ou o plano expirou. Renove em Minha assinatura para voltar a enviar.`;
  }, [readOnlyMode, config?.trialHours]);

  const needsOnboardingGate =
    enforce &&
    !!user &&
    !workspaceLoading &&
    !isPlatformAdminUser(user) &&
    !effectiveSubscription &&
    !optimisticTrialEndsAt;

  const value = useMemo(
    () => ({
      subscription: effectiveSubscription,
      loading,
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
