import React, { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { useSubscription } from '../../context/SubscriptionContext';
import { formatTrialHoursLabel } from '../../utils/trialCopy';
import { persistTrialEndFromServer } from '../../utils/trialLocalEnd';
import { requestTrialStart } from '../../utils/startTrialClient';
import { trackTrialStarted } from '../../utils/marketingEvents';
import { isPlatformAdminUser } from '../../utils/adminAccess';

/** Se a landing marcou sessionStorage, inicia o teste de 1h uma vez apos o login. */
export const TrialAutoStart: React.FC = () => {
  const { user } = useAuth();
  const { config } = useAppConfig();
  const { applyTrialActivation } = useSubscription();
  const ran = useRef(false);

  useEffect(() => {
    if (!user || ran.current) return;
    if (isPlatformAdminUser(user)) return;
    let forceIfNeeded = false;
    try {
      const explicit = sessionStorage.getItem('zapmass.startTrialAfterLogin') === '1';
      forceIfNeeded = sessionStorage.getItem('zapmass.tryTrialIfNeededAfterLogin') === '1';
      if (!explicit && !forceIfNeeded) return;
    } catch {
      return;
    }
    ran.current = true;
    try {
      sessionStorage.removeItem('zapmass.startTrialAfterLogin');
      sessionStorage.removeItem('zapmass.tryTrialIfNeededAfterLogin');
    } catch {
      /* ignore */
    }

    let cancelled = false;
    void (async () => {
      const result = await requestTrialStart(() => user.getIdToken());
      if (cancelled) return;
      if (result.ok === false) {
        if (!result.ignorable && !forceIfNeeded) toast.error(result.error);
        return;
      }
      if (result.trialEndsAt) {
        applyTrialActivation(result.trialEndsAt);
        persistTrialEndFromServer(result.trialEndsAt);
      }
      if (!result.alreadyActive) {
        trackTrialStarted(config.trialHours);
        toast.success(`Teste de ${formatTrialHoursLabel(config.trialHours)} ativado! Aproveite o ZapMass.`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, config.trialHours, applyTrialActivation]);

  return null;
};
