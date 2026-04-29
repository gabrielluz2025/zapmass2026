import type { SubscriptionPlan } from './subscriptionFirestore.js';

export type ParsedMpExternalReference =
  | { kind: 'plan'; uid: string; plan: SubscriptionPlan }
  | { kind: 'tier_plan'; uid: string; plan: SubscriptionPlan; channels: number }
  | { kind: 'tier_upgrade'; uid: string; fromChannels: number; toChannels: number; plan: SubscriptionPlan }
  | { kind: 'chaddon_once'; uid: string; extraSlots: number }
  | { kind: 'chaddon_recur'; uid: string; extraSlots: number }
  | { kind: 'none' };

/**
 * Referência externa Mercado Pago: `uid:monthly|annual`, `uid:tier:3:monthly`,
 * `uid:chaddon_once:1`, `uid:chaddon_recur:2`, `uid:tier_upgrade:...`.
 */
export function parseExternalReference(ref: string | undefined | null): ParsedMpExternalReference {
  if (!ref || typeof ref !== 'string') return { kind: 'none' };
  const parts = ref.split(':').map((s) => s.trim());
  const uid = parts[0] || '';
  if (!uid) return { kind: 'none' };
  const mid = (parts[1] || '').toLowerCase();
  if (mid === 'chaddon_once' || mid === 'chaddon-once') {
    const n = Math.min(3, Math.max(1, parseInt(parts[2] || '0', 10) || 0));
    if (n >= 1 && n <= 3) return { kind: 'chaddon_once', uid, extraSlots: n };
  }
  if (mid === 'chaddon_recur' || mid === 'chaddon-recur') {
    const n = Math.min(3, Math.max(1, parseInt(parts[2] || '0', 10) || 0));
    if (n >= 1 && n <= 3) return { kind: 'chaddon_recur', uid, extraSlots: n };
  }
  if (mid === 'tier') {
    const channels = Math.max(1, Math.min(5, parseInt(parts[2] || '0', 10) || 0));
    const rawPlan = (parts[3] || 'monthly').toLowerCase();
    const plan: SubscriptionPlan =
      rawPlan === 'annual' || rawPlan === 'anual' ? 'annual' : rawPlan === 'monthly' || rawPlan === 'mensal' ? 'monthly' : null;
    if (channels >= 1 && channels <= 5 && plan) return { kind: 'tier_plan', uid, plan, channels };
  }
  if (mid === 'tier_upgrade') {
    const from = Math.max(1, Math.min(5, parseInt(parts[2] || '0', 10) || 0));
    const to = Math.max(1, Math.min(5, parseInt(parts[3] || '0', 10) || 0));
    const rawPlan = (parts[4] || 'monthly').toLowerCase();
    const plan: SubscriptionPlan =
      rawPlan === 'annual' || rawPlan === 'anual' ? 'annual' : rawPlan === 'monthly' || rawPlan === 'mensal' ? 'monthly' : null;
    if (from >= 1 && to >= 1 && plan) return { kind: 'tier_upgrade', uid, fromChannels: from, toChannels: to, plan };
  }
  const p = mid;
  const plan: SubscriptionPlan =
    p === 'monthly' || p === 'mensal' ? 'monthly' : p === 'annual' || p === 'anual' ? 'annual' : null;
  return { kind: 'plan', uid, plan };
}
