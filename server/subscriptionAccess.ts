import type { UserSubscriptionDoc } from './subscriptionFirestore.js';

function tsToMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    try {
      return (v as { toMillis: () => number }).toMillis();
    } catch {
      return null;
    }
  }
  if (typeof v === 'string') {
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : null;
  }
  if (v instanceof Date) {
    return v.getTime();
  }
  return null;
}

/**
 * Regra alinhada a `src/context/SubscriptionContext` (hasFullAccess).
 * Usada no socket e em limites de canais.
 */
export function userHasFullAppAccess(
  sub: UserSubscriptionDoc | null | undefined,
  now: number
): boolean {
  if (!sub) return false;
  if (sub.blocked === true) return false;
  const manualEnd = tsToMs(sub.manualAccessEndsAt);
  if (sub.manualGrant === true) {
    if (manualEnd == null) return true;
    return now < manualEnd;
  }
  const trialEnd = tsToMs(sub.trialEndsAt);
  const accessEnd = tsToMs(sub.accessEndsAt);
  if (sub.status === 'active') {
    if (accessEnd == null) return true;
    return now < accessEnd;
  }
  if (sub.status === 'trialing' && trialEnd != null) {
    return now < trialEnd;
  }
  return false;
}

/**
 * Em produção, por omissão, exige assinatura/trial válido em ações sensíveis.
 * `SUBSCRIPTION_ENFORCE=0` desliga (desenvolvimento / staging).
 */
export function subscriptionEnforceFromEnv(): boolean {
  const raw = String(process.env.SUBSCRIPTION_ENFORCE ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes') return true;
  return process.env.NODE_ENV === 'production';
}
