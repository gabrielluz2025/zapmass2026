import { fetchSignInMethodsForEmail, type Auth } from 'firebase/auth';

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
