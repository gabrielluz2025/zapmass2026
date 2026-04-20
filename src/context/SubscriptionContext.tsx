import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { firestoreTimeToMs } from '../utils/firestoreTime';
import { useAuth } from './AuthContext';
import { useAppConfig } from './AppConfigContext';
import { formatTrialHoursLabel } from '../utils/trialCopy';
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
  accessAllowed: true
});

export const SubscriptionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { config } = useAppConfig();
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [loading, setLoading] = useState(true);

  const enforce = import.meta.env.VITE_ENFORCE_SUBSCRIPTION === 'true';

  useEffect(() => {
    if (!user) {
      setSubscription(null);
      setLoading(false);
      return;
    }
    const ref = doc(db, 'userSubscriptions', user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setSubscription(null);
        } else {
          setSubscription(snap.data() as UserSubscription);
        }
        setLoading(false);
      },
      (err) => {
        console.error('[SubscriptionContext]', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user]);

  const hasFullAccess = useMemo(() => {
    if (!enforce) return true;
    if (!user) return false;
    if (!subscription) return false;
    const now = Date.now();
    const trialEnd = firestoreTimeToMs(subscription.trialEndsAt);
    const accessEnd = firestoreTimeToMs(subscription.accessEndsAt);

    if (subscription.status === 'active') {
      if (accessEnd == null) return true;
      return now < accessEnd;
    }
    if (subscription.status === 'trialing' && trialEnd != null) {
      return now < trialEnd;
    }
    return false;
  }, [enforce, user, subscription]);

  const readOnlyMode = useMemo(() => {
    if (!enforce || !user) return false;
    if (!subscription) return false;
    return !hasFullAccess;
  }, [enforce, user, subscription, hasFullAccess]);

  const needsOnboardingGate = useMemo(() => {
    if (!enforce || !user || loading) return false;
    return subscription === null;
  }, [enforce, user, loading, subscription]);

  const readOnlyMessage = useMemo(() => {
    if (!readOnlyMode || !subscription) {
      return 'Acesso as acoes bloqueado. Assine o ZapMass Pro para continuar.';
    }
    const now = Date.now();
    const trialEnd = firestoreTimeToMs(subscription.trialEndsAt);
    const accessEnd = firestoreTimeToMs(subscription.accessEndsAt);
    if (subscription.status === 'trialing' && trialEnd != null && now >= trialEnd) {
      return `Seu teste de ${formatTrialHoursLabel(config.trialHours)} encerrou. Voce pode navegar pelo app; para usar campanhas, chips e disparos, assine o Pro.`;
    }
    if (subscription.status === 'active' && accessEnd != null && now >= accessEnd) {
      return 'Seu periodo pago encerrou. Renove o plano (mensal ou anual) para liberar todas as acoes.';
    }
    return 'Periodo sem acesso completo. Assine ou renove o Pro para voltar a operar o sistema.';
  }, [readOnlyMode, subscription, config.trialHours]);

  const accessAllowed = hasFullAccess;

  const value = useMemo(
    () => ({
      subscription,
      loading,
      enforce,
      hasFullAccess,
      readOnlyMode,
      readOnlyMessage,
      needsOnboardingGate,
      accessAllowed
    }),
    [subscription, loading, enforce, hasFullAccess, readOnlyMode, readOnlyMessage, needsOnboardingGate, accessAllowed]
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
};

export const useSubscription = () => useContext(SubscriptionContext);
