import { apiUrl } from './apiBase';

export type EmailAuthStep = 'sign-in' | 'sign-up';

const EMAIL_STEP_TIMEOUT_MS = 15_000;

/** Consulta se o e-mail já tem conta (auth VPS / Postgres). */
export async function resolveEmailAuthStep(email: string): Promise<EmailAuthStep> {
  const trimmed = email.trim().toLowerCase();
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), EMAIL_STEP_TIMEOUT_MS);
  try {
    const r = await fetch(apiUrl('/api/auth/email-step'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: trimmed }),
      signal: ctrl.signal
    });
    const data = (await r.json()) as { ok?: boolean; step?: string; error?: string };
    if (data?.ok && data.step === 'sign-in') return 'sign-in';
    if (data?.ok && data.step === 'sign-up') return 'sign-up';
  } catch {
    /* rede ou timeout — assume cadastro */
  } finally {
    window.clearTimeout(timer);
  }
  return 'sign-up';
}

/** @deprecated Use resolveEmailAuthStep */
export const resolveEmailAuthStepVps = resolveEmailAuthStep;
