const KEY = 'zapmass_trial_ends_ms';

/** Grava o fim do teste apos resposta OK do servidor (mitiga atraso do snapshot Firestore). */
export function persistTrialEndFromServer(trialEndsAtIso: string | undefined): void {
  if (!trialEndsAtIso) return;
  const ms = Date.parse(trialEndsAtIso);
  if (!Number.isFinite(ms)) return;
  try {
    localStorage.setItem(KEY, String(ms));
  } catch {
    /* ignore */
  }
}

export function readTrialEndMsFromLocal(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return n;
  } catch {
    return null;
  }
}

export function clearTrialEndLocal(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
