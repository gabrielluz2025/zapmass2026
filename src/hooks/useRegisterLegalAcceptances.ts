import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { recordLegalAcceptance } from '../services/tenantExtrasApi';

export const PLATFORM_TERMS_VERSION = '2026-07-06';
export const PLATFORM_PRIVACY_VERSION = '2026-07-06';

/** Registra aceite de Termos/Privacidade da plataforma uma vez por versão (server-side). */
export function useRegisterLegalAcceptances(): void {
  const { user } = useAuth();
  const doneRef = useRef(false);

  useEffect(() => {
    if (!user || doneRef.current) return;
    doneRef.current = true;

    void (async () => {
      try {
        const token = await user.getIdToken();
        const key = `zapmass.legal.v1.${PLATFORM_TERMS_VERSION}`;
        if (!localStorage.getItem(key)) {
          await recordLegalAcceptance(token, 'terms_of_use', PLATFORM_TERMS_VERSION);
          await recordLegalAcceptance(token, 'privacy_policy', PLATFORM_PRIVACY_VERSION);
          localStorage.setItem(key, new Date().toISOString());
        }
      } catch {
        /* best-effort */
      }
    })();
  }, [user]);
}
