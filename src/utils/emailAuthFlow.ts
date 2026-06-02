import { fetchSignInMethodsForEmail, type Auth } from 'firebase/auth';
import { apiUrl } from './apiBase';

export type EmailAuthStep = 'sign-in' | 'sign-up';

/**
 * Decide se o e-mail já tem senha ou precisa cadastrar.
 * Com proteção contra enumeração do Firebase, `fetchSignInMethodsForEmail` falha ou devolve [] —
 * nesse caso assumimos cadastro (fluxo de cliente novo).
 */
export async function resolveEmailAuthStep(auth: Auth, email: string): Promise<EmailAuthStep> {
  const trimmed = email.trim().toLowerCase();
  try {
    const methods = await fetchSignInMethodsForEmail(auth, trimmed);
    return methods.includes('password') ? 'sign-in' : 'sign-up';
  } catch {
    return 'sign-up';
  }
}

/** Modo VPS: consulta Postgres se o e-mail já tem conta. */
export async function resolveEmailAuthStepVps(email: string): Promise<EmailAuthStep> {
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
