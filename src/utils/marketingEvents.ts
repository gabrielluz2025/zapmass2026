/**
 * Eventos para GA4 (`gtag`) ou Google Tag Manager (`dataLayer`).
 * Configure no painel da Meta/Google ou via snippet que exponha `window.gtag` ou `window.dataLayer`.
 */
export function trackLandingEvent(action: string, params?: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    type Win = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
    const w = window as Win;
    const flat = params ?? {};
    if (typeof w.gtag === 'function') {
      w.gtag('event', action, flat);
      return;
    }
    if (Array.isArray(w.dataLayer)) {
      w.dataLayer.push({ event: action, ...flat });
    }
  } catch {
    /* ignore */
  }
}

/** Conclusão do fluxo de autenticação (funil pós-clique nos CTAs da landing). */
export function trackLoginSuccess(method: 'google' | 'facebook' | 'apple' | 'staff'): void {
  trackLandingEvent('login_success', { method });
}

/** Trial ativado com sucesso via POST /api/billing/trial/start (resposta ok). */
export function trackTrialStarted(trialHours: number): void {
  const h = Math.max(1, Math.min(168, Math.round(Number(trialHours)) || 1));
  trackLandingEvent('trial_started', { trial_hours: String(h) });
}
