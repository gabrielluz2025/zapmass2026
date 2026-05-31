/** Marca intenção pós-login: trial automático ou só tentar se ainda não tiver plano. */
export function setTrialSessionForManager(mode: 'trial' | 'customer'): void {
  try {
    if (mode === 'trial') {
      sessionStorage.setItem('zapmass.startTrialAfterLogin', '1');
      sessionStorage.removeItem('zapmass.tryTrialIfNeededAfterLogin');
    } else {
      sessionStorage.removeItem('zapmass.startTrialAfterLogin');
      sessionStorage.setItem('zapmass.tryTrialIfNeededAfterLogin', '1');
    }
  } catch {
    /* ignore */
  }
}

export function clearTrialSessionFlags(): void {
  try {
    sessionStorage.removeItem('zapmass.startTrialAfterLogin');
    sessionStorage.removeItem('zapmass.tryTrialIfNeededAfterLogin');
  } catch {
    /* ignore */
  }
}

/** CTAs da landing que indicam cadastro / teste grátis (não «já sou cliente»). */
export function landingCtaStartsTrial(ctaId: string): boolean {
  if (!ctaId || ctaId === 'header_signin') return false;
  return true;
}
