import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import type { UserSubscriptionDoc } from './subscriptionFirestore.js';
import { filterByConnectionScope } from '../src/utils/connectionScope.js';
import { subscriptionEnforceFromEnv, userHasFullAppAccess } from './subscriptionAccess.js';

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

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function tsToMs(v: unknown): number | null {
  if (!v) return null;
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
  return null;
}

/** Em teste, `extraChannelSlots` no doc só vale se houver prova de add-on (evita valor residual no merge). */
function hasChannelAddonPurchaseProof(sub: UserSubscriptionDoc | null | undefined): boolean {
  if (!sub) return false;
  if (sub.manualGrant === true) return true;
  if (nonEmptyString(sub.mercadoPagoChannelAddonPreapprovalId)) return true;
  if (nonEmptyString(sub.mercadoPagoChannelAddonOneTimePaymentId)) return true;
  return false;
}

/** Inclui trial ainda ativo; trial expirado = false. */
function statusAllowsPaidExtras(sub: UserSubscriptionDoc | null | undefined, now: number = Date.now()): boolean {
  return userHasFullAppAccess(sub, now);
}

function manualGrantedExtraSlots(sub: UserSubscriptionDoc | null | undefined): number {
  if (!sub) return 0;
  const raw = Math.max(
    0,
    Math.min(MAX_EXTRA_CHANNEL_SLOTS, Math.floor(Number(sub.manualExtraChannelSlots) || 0))
  );
  if (raw <= 0) return 0;
  const endMs = tsToMs(sub.manualExtraChannelSlotsEndsAt);
  if (endMs == null) return raw;
  return endMs > Date.now() ? raw : 0;
}

function paidIncludedChannels(sub: UserSubscriptionDoc | null | undefined): number {
  const n = Math.floor(Number(sub?.includedChannels) || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(1, Math.min(MAX_CONNECTIONS_TOTAL, n));
}

/**
 * Cada slot extra pago = +1 acima de BASE (até 3 extras).
 * Firestore: `extraChannelSlots` 0..3
 *
 * Nunca confia so em `extraChannelSlots`: sem prova (preapproval, pagamento one-time do add-on ou
 * `manualGrant`) o teto fica em 2, mesmo com `active` e numero errado no documento.
 */
export function getMaxConnectionSlots(
  sub: UserSubscriptionDoc | null | undefined,
  options: { serverAdmin: boolean }
): number {
  // Para canais WhatsApp, admin também respeita 2 + extras comprados.
  // (ADMIN_EMAILS segue válido para rotas/painéis administrativos.)
  void options.serverAdmin;
  const included = paidIncludedChannels(sub);
  if (included > 0 && statusAllowsPaidExtras(sub, Date.now())) {
    const manualExtras = manualGrantedExtraSlots(sub);
    return Math.min(MAX_CONNECTIONS_TOTAL, included + manualExtras);
  }
  const raw = Math.max(
    0,
    Math.min(MAX_EXTRA_CHANNEL_SLOTS, Math.floor(Number(sub?.extraChannelSlots) || 0))
  );
  const paidExtras = statusAllowsPaidExtras(sub, Date.now()) && hasChannelAddonPurchaseProof(sub) ? raw : 0;
  const manualExtras = manualGrantedExtraSlots(sub);
  const effective = Math.max(paidExtras, manualExtras);
  return Math.min(MAX_CONNECTIONS_TOTAL, BASE_CONNECTION_SLOTS + effective);
}

/**
 * Conta o mesmo subconjunto que `filterByConnectionScope` (e a UI) — inclui legados
 * só para o socket "anonymous"; com UID real nao se misturam canais legados
 * invisiveis a uma conta, que antes permitiam criação extra.
 */
export function countUserScopedConnections(connections: Array<{ id: string }>, uid: string | null | undefined): number {
  const scope = !uid || uid === 'anonymous' ? 'anonymous' : uid;
  return filterByConnectionScope(scope, connections).length;
}

/** Resultado de `evaluateMayCreateWaConnection` — alinhado ao handler `socket` create-connection antes do enqueue. */
export type MayCreateWaConnectionResult =
  | { ok: true }
  | { ok: false; reason: 'subscription-required' }
  | {
      ok: false;
      reason: 'connection-limit-reached';
      current: number;
      max: number;
      message: string;
    };

/**
 * Regra única para API + worker Redis: mesmo pedido só cria Canal se subscrição/limites baterem aqui na hora de executar.
 * Evita fila/processar comandos quando o cliente já recebeu `connection-limit-reached`.
 */
export async function evaluateMayCreateWaConnection(
  uid: string,
  connections: Array<{ id: string }>
): Promise<MayCreateWaConnectionResult> {
  const uidStr = String(uid || 'anonymous');

  if (subscriptionEnforceFromEnv()) {
    if (uidStr && uidStr !== 'anonymous') {
      if (!(await isUidTreatedAsServerAdmin(uidStr))) {
        const sub = await readUserSubscriptionForLimits(uidStr);
        if (!userHasFullAppAccess(sub, Date.now())) {
          return { ok: false, reason: 'subscription-required' };
        }
      }
    }
  }

  let maxAllowed = BASE_CONNECTION_SLOTS;
  if (uidStr && uidStr !== 'anonymous') {
    try {
      const [sub, isServAdmin] = await Promise.all([
        readUserSubscriptionForLimits(uidStr),
        isUidTreatedAsServerAdmin(uidStr)
      ]);
      maxAllowed = getMaxConnectionSlots(sub, { serverAdmin: isServAdmin });
    } catch (e) {
      console.error('[create-connection] leitura assinatura; aplica teto base', e);
      maxAllowed = BASE_CONNECTION_SLOTS;
    }
  }
  const count = countUserScopedConnections(connections, uidStr);
  if (count >= maxAllowed) {
    return {
      ok: false,
      reason: 'connection-limit-reached',
      current: count,
      max: maxAllowed,
      message:
        maxAllowed <= BASE_CONNECTION_SLOTS
          ? `Limite de ${maxAllowed} canal(is) do plano atual. Ajuste o plano em Minha assinatura para liberar mais canais (ate 5).`
          : `Voce atingiu o maximo de ${maxAllowed} canal(is) do plano contratado. Em Minha assinatura, selecione um plano com mais canais (ate 5).`
    };
  }
  return { ok: true };
}

export function channelAddonUnitPriceBrl(): number {
  const n = parseFloat(process.env.MERCADOPAGO_CHANNEL_ADDON_MONTHLY || '100');
  return Number.isFinite(n) && n > 0 ? n : 100;
}
