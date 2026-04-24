import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import type { UserSubscriptionDoc } from './subscriptionFirestore.js';
import { isLegacyConnectionId } from '../src/utils/connectionScope.js';

/** Incluídos no plano. */
export const BASE_CONNECTION_SLOTS = 2;
/** Máximo de canais (2 base + 3 extras). */
export const MAX_CONNECTIONS_TOTAL = 5;
export const MAX_EXTRA_CHANNEL_SLOTS = 3;

function adminEmailSet(): Set<string> {
  const raw = process.env.ADMIN_EMAILS?.trim() || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function isUidTreatedAsServerAdmin(uid: string): Promise<boolean> {
  if (!uid || uid === 'anonymous') return false;
  const app = getFirebaseAdmin();
  if (!app) return false;
  try {
    const u = await getAuth(app).getUser(uid);
    const email = (u.email || '').toLowerCase();
    return email && adminEmailSet().has(email);
  } catch {
    return false;
  }
}

export async function readUserSubscriptionForLimits(uid: string): Promise<UserSubscriptionDoc | null> {
  const app = getFirebaseAdmin();
  if (!app) return null;
  const db = getFirestore(app);
  const snap = await db.collection('userSubscriptions').doc(uid).get();
  if (!snap.exists) return null;
  return snap.data() as UserSubscriptionDoc;
}

/**
 * Cada slot extra pago = +1 acima de BASE (até 3 extras).
 * Firestore: `extraChannelSlots` 0..3
 */
export function getMaxConnectionSlots(
  sub: UserSubscriptionDoc | null | undefined,
  options: { serverAdmin: boolean }
): number {
  if (options.serverAdmin) return 999;
  const extra = Math.max(
    0,
    Math.min(MAX_EXTRA_CHANNEL_SLOTS, Math.floor(Number((sub as { extraChannelSlots?: unknown })?.extraChannelSlots) || 0))
  );
  return Math.min(MAX_CONNECTIONS_TOTAL, BASE_CONNECTION_SLOTS + extra);
}

/**
 * Só canais com id `uid__...` contam para o teto. Canais legados (sem `__`) não entram
 * (evita bloquear quem ainda tem IDs antigos).
 */
export function countUserScopedConnections(connections: Array<{ id: string }>, uid: string | null | undefined): number {
  if (!uid || uid === 'anonymous') {
    return connections.filter((c) => isLegacyConnectionId(c.id)).length;
  }
  return connections.filter((c) => typeof c.id === 'string' && c.id.startsWith(`${uid}__`)).length;
}

export function channelAddonUnitPriceBrl(): number {
  const n = parseFloat(process.env.MERCADOPAGO_CHANNEL_ADDON_MONTHLY || '100');
  return Number.isFinite(n) && n > 0 ? n : 100;
}
