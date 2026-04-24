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
        } else {
          const msg = typeof data.error === 'string' ? data.error : 'Nao foi possivel ativar o teste.';
          // No modo "Já sou cliente", tentamos iniciar o teste somente se necessário.
          // Se já houver assinatura/trial ativo, não exibimos erro para não confundir.
          if (forceIfNeeded) {
            const silenced = [
              'Voce ja possui assinatura ativa.',
              'Seu teste gratuito ainda esta em andamento.'
            ];
            if (silenced.includes(msg)) return;
          }
          toast.error(msg);
        }
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
