import React, { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { formatTrialHoursLabel } from '../../utils/trialCopy';
import { persistTrialEndFromServer } from '../../utils/trialLocalEnd';

/** Se a landing marcou sessionStorage, inicia o teste de 1h uma vez apos o login. */
export const TrialAutoStart: React.FC = () => {
  const { user } = useAuth();
  const { config } = useAppConfig();
  const ran = useRef(false);

  useEffect(() => {
    if (!user || ran.current) return;
    try {
      if (sessionStorage.getItem('zapmass.startTrialAfterLogin') !== '1') return;
    } catch {
      return;
    }
    ran.current = true;
    try {
      sessionStorage.removeItem('zapmass.startTrialAfterLogin');
    } catch {
      /* ignore */
    }

    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch('/api/billing/trial/start', {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` }
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (data.ok) {
          persistTrialEndFromServer(typeof data.trialEndsAt === 'string' ? data.trialEndsAt : undefined);
          toast.success(`Teste de ${formatTrialHoursLabel(config.trialHours)} ativado! Aproveite o ZapMass.`);
        } else toast.error(typeof data.error === 'string' ? data.error : 'Nao foi possivel ativar o teste.');
      } catch {
        if (!cancelled) toast.error('Erro de rede ao ativar o teste.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, config.trialHours]);

  return null;
};
