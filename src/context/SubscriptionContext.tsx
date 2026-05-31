import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { firestoreTimeToMs } from '../utils/firestoreTime';
import { useAuth } from './AuthContext';
import { useWorkspace } from './WorkspaceContext';
import { useAppConfig } from './AppConfigContext';
import { formatTrialHoursLabel } from '../utils/trialCopy';
import { isPlatformAdminUser } from '../utils/adminAccess';
import type { UserSubscription } from '../types';

interface SubscriptionContextValue {
  subscription: UserSubscription | null;
  loading: boolean;
  /** Se true (VITE_ENFORCE_SUBSCRIPTION), o servidor exige plano ativo ou teste valido para acoes. */
  enforce: boolean;
  /**
   * Uso completo (campanhas, conexoes, etc.). Quando enforce e false, sempre true.
   */
  hasFullAccess: boolean;
  /** Logado com enforce, documento existe, mas periodo de teste ou pago expirou — UI navegavel, acoes bloqueadas. */
  readOnlyMode: boolean;
  /** Texto para faixa fixa em modo leitura. */
  readOnlyMessage: string;
  /** Primeiro acesso: enforce ligado, sem doc no Firestore — tela de onboarding (teste ou pagamento). */
  needsOnboardingGate: boolean;
  /** Após POST /api/billing/trial/start — liberta o gate antes do onSnapshot do Firestore. */
  applyTrialActivation: (trialEndsAtIso: string) => void;
  /** @deprecated Use hasFullAccess. Mantido para compatibilidade. */
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

  const subscriptionUid = user?.uid ? effectiveWorkspaceUid ?? user.uid : null;

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
    const subUid = effectiveWorkspaceUid ?? user.uid;
    const ref = doc(db, 'userSubscriptions', subUid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setSubscription(null);
        } else {
          setSubscription(snap.data() as UserSubscription);
          setOptimisticTrialEndsAt(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error('[SubscriptionContext]', err);
        setLoading(false);
      }
    );
    return () => unsub();
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

  const readOnlyMode = useMemo(() => {
    if (!enforce || !user) return false;
    if (isPlatformAdminUser(user)) return false;
    if (!effectiveSubscription) return false;
    return !hasFullAccess;
  }, [enforce, user, effectiveSubscription, hasFullAccess]);

  const needsOnboardingGate = useMemo(() => {
    if (!enforce || !user || loading) return false;
    if (isPlatformAdminUser(user)) return false;
    return effectiveSubscription === null;
  }, [enforce, user, loading, effectiveSubscription]);

  const readOnlyMessage = useMemo(() => {
    if (!readOnlyMode || !effectiveSubscription) {
      return 'Acesso as acoes bloqueado. Assine o ZapMass Pro para continuar.';
    }
    if (effectiveSubscription.blocked === true) {
      return 'Sua conta foi bloqueada pelo administrador. Entre em contato com o suporte para liberar o acesso.';
    }
    if (effectiveSubscription.manualGrant === true) {
      const manualEnd = firestoreTimeToMs(effectiveSubscription.manualAccessEndsAt);
      if (manualEnd != null && Date.now() >= manualEnd) {
        return 'Sua liberação administrativa expirou. Solicite renovação ao administrador ou assine um plano.';
      }
      return 'Seu acesso administrativo foi revogado. Solicite ajuste ao administrador.';
    }
    const now = Date.now();
    const trialEnd = firestoreTimeToMs(effectiveSubscription.trialEndsAt);
    const accessEnd = firestoreTimeToMs(effectiveSubscription.accessEndsAt);
    if (effectiveSubscription.status === 'trialing' && trialEnd != null && now >= trialEnd) {
      return `Seu teste de ${formatTrialHoursLabel(config.trialHours)} encerrou. Voce pode navegar pelo app; para usar campanhas, chips e disparos, assine o Pro.`;
    }
    if (effectiveSubscription.status === 'active' && accessEnd != null && now >= accessEnd) {
      return 'Seu periodo pago encerrou. Renove o plano (mensal ou anual) para liberar todas as acoes.';
    }
    return 'Periodo sem acesso completo. Assine ou renove o Pro para voltar a operar o sistema.';
  }, [readOnlyMode, effectiveSubscription, config.trialHours]);

  const accessAllowed = hasFullAccess;

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
      accessAllowed
    }),
    [
      effectiveSubscription,
      loading,
      enforce,
      hasFullAccess,
      readOnlyMode,
      readOnlyMessage,
      needsOnboardingGate,
      applyTrialActivation,
      accessAllowed
    ]
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
};

export const useSubscription = () => useContext(SubscriptionContext);
