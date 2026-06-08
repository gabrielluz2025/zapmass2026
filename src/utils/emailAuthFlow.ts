import { apiUrl } from './apiBase';

export type EmailAuthStep = 'sign-in' | 'sign-up';

/** Consulta se o e-mail já tem conta (auth VPS / Postgres). */
export async function resolveEmailAuthStep(email: string): Promise<EmailAuthStep> {
  const trimmed = email.trim().toLowerCase();
  try {
    const r = await fetch(apiUrl('/api/auth/email-step'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: trimmed })
    });
    const data = (await r.json()) as { ok?: boolean; step?: string; error?: string };
    if (data?.ok && data.step === 'sign-in') return 'sign-in';
    if (data?.ok && data.step === 'sign-up') return 'sign-up';
  } catch {
    /* rede — assume cadastro */
  }
  return 'sign-up';
}

/** @deprecated Use resolveEmailAuthStep */
export const resolveEmailAuthStepVps = resolveEmailAuthStep;
