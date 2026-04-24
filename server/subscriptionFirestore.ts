import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { addCalendarMonths } from './subscriptionPeriod.js';

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'none';
export type SubscriptionProvider = 'mercadopago' | 'infinitepay' | 'none';
export type SubscriptionPlan = 'monthly' | 'annual' | null;

export interface UserSubscriptionDoc {
  status: SubscriptionStatus;
  provider: SubscriptionProvider;
  plan: SubscriptionPlan;
  mercadoPagoPreapprovalId?: string;
  mercadoPagoLastPaymentId?: string;
  infinitePayReference?: string;
  /** Fim do teste gratuito (1h). */
  trialEndsAt?: Timestamp | null;
  /** Fim do periodo pago atual (mensal = +1 mes calendario; anual = +12 meses). */
  accessEndsAt?: Timestamp | null;
  /**
   * Canais extras contratados (0–3), além de 2 incluídos. Cada unidade = +R$ /mês (ver MERCADOPAGO_CHANNEL_ADDON_MONTHLY).
   * Teto: 2 + extraChannelSlots ≤ 5.
   */
  extraChannelSlots?: number;
  /** Preapproval do Mercado Pago dedicado ao add-on de canais (débito mensal do pacote de extras). */
  mercadoPagoChannelAddonPreapprovalId?: string;
  /** Se true, o teste de 1h ja foi concedido nesta conta (nao repetir). */
  freeTrialUsed?: boolean;
  /** Id da ultima NFS-e emitida no NFE.io (quando nfe-io ativo). */
  nfeLastInvoiceId?: string;
  /** Status da ultima NFS-e (Processing|Issued|Cancelled|Error). */
  nfeLastInvoiceStatus?: string;
  /** URL do PDF da ultima NFS-e emitida (disponivel apos aprovacao da prefeitura). */
  nfeLastInvoicePdfUrl?: string;
}

const COLLECTION = 'userSubscriptions';

export async function mergeUserSubscription(uid: string, partial: Partial<UserSubscriptionDoc>): Promise<boolean> {
  const app = getFirebaseAdmin();
  if (!app) {
    console.warn('[SubscriptionFirestore] Firebase Admin nao configurado — webhook ignorado para persistencia.');
    return false;
  }
  const db = getFirestore(app);
  await db.collection(COLLECTION).doc(uid).set(
    {
      ...partial,
      updatedAt: FieldValue.serverTimestamp()
    } as Record<string, unknown>,
    { merge: true }
  );
  return true;
}

/**
 * Estende ou inicia periodo pago: soma 1 ou 12 meses calendario a partir do max(agora, accessEndsAt atual).
 */
export async function extendPaidSubscription(
  uid: string,
  plan: 'monthly' | 'annual',
  extra: Partial<UserSubscriptionDoc> = {}
): Promise<boolean> {
  const app = getFirebaseAdmin();
  if (!app) {
    console.warn('[SubscriptionFirestore] extendPaidSubscription: sem Firebase Admin.');
    return false;
  }
  const db = getFirestore(app);
  const ref = db.collection(COLLECTION).doc(uid);
  const snap = await ref.get();
  const cur = snap.data() as UserSubscriptionDoc | undefined;
  const now = Date.now();
  let base = new Date();
  const existingEnd = cur?.accessEndsAt?.toMillis?.() ?? null;
  if (existingEnd != null && existingEnd > now) {
    base = new Date(existingEnd);
  }
  const monthsToAdd = plan === 'monthly' ? 1 : 12;
  const endDate = addCalendarMonths(base, monthsToAdd);
  await ref.set(
    {
      ...extra,
      status: 'active',
      plan,
      accessEndsAt: Timestamp.fromDate(endDate),
      trialEndsAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    } as Record<string, unknown>,
    { merge: true }
  );
  return true;
}
