import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';

const INVITES_COLLECTION = 'publicInboxSurveyInvites';
export const SURVEY_TOKEN_HEX_LEN = 40;

/** Token opaco gravado só via Admin SDK; página pública + POST sem auth. */
export async function createPublicSurveyInvite(
  db: Firestore,
  tenantUid: string,
  conversationId: string,
  connectionId: string
): Promise<string> {
  const token = randomBytes(SURVEY_TOKEN_HEX_LEN / 2).toString('hex');
  const ref = db.collection(INVITES_COLLECTION).doc(token);
  const ttlDays = Number(process.env.INBOX_CLIENT_SURVEY_TTL_DAYS ?? 14);
  const ttlMs = Math.max(1, Math.min(90, Number.isFinite(ttlDays) ? ttlDays : 14)) * 24 * 60 * 60 * 1000;
  await ref.set({
    tenantUid,
    conversationId,
    connectionId,
    expiresAt: Timestamp.fromMillis(Date.now() + ttlMs),
    consumed: false,
    createdAt: FieldValue.serverTimestamp()
  });
  return token;
}

export function buildClientSurveyUrl(publicOrigin: string, token: string): string {
  const base = publicOrigin.trim().replace(/\/+$/, '');
  return `${base}/avaliacao?t=${encodeURIComponent(token)}`;
}

export function whatsappSurveyMessageBody(url: string): string {
  const custom = (process.env.INBOX_CLIENT_SURVEY_WHATSAPP_BODY || '').trim();
  if (custom) return custom.includes('{URL}') || custom.includes('{url}') ? custom.split('{URL}').join(url).split('{url}').join(url) : `${custom}\n\n${url}`;
  return (
    `Atendimento finalizado por aqui.\n\n` +
    `Quando possível, avalie o nosso serviço (é rápido e opcional):\n${url}\n\n` +
    `Obrigado!`
  );
}

export type SurveyInviteLookup =
  | { status: 'valid' }
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'already_used' };

export async function lookupSurveyInvite(db: Firestore, token: string): Promise<SurveyInviteLookup> {
  const snap = await db.collection(INVITES_COLLECTION).doc(token).get();
  if (!snap.exists) return { status: 'not_found' };
  const data = snap.data()!;
  if (data.consumed === true) return { status: 'already_used' };
  const exp = data.expiresAt as Timestamp | undefined;
  if (exp instanceof Timestamp && exp.toMillis() < Date.now()) return { status: 'expired' };
  return { status: 'valid' };
}

export async function submitSurveyInviteResponse(
  db: Firestore,
  token: string,
  rating: number,
  commentTrimmed: string
): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND' | 'USED' | 'EXPIRED' | 'BAD_RATING' }> {
  if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    return { ok: false, code: 'BAD_RATING' };
  }

  const ref = db.collection(INVITES_COLLECTION).doc(token);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('NOT_FOUND');
      const d = snap.data()!;
      if (d.consumed === true) throw new Error('USED');
      const exp = d.expiresAt as Timestamp | undefined;
      if (exp instanceof Timestamp && exp.toMillis() < Date.now()) throw new Error('EXPIRED');

      const tenantUid = typeof d.tenantUid === 'string' ? d.tenantUid.trim() : '';
      const conversationId = typeof d.conversationId === 'string' ? d.conversationId.trim() : '';
      if (!tenantUid || !conversationId) throw new Error('NOT_FOUND');

      tx.update(ref, {
        consumed: true,
        consumedAt: FieldValue.serverTimestamp(),
        consumedRating: rating
      });

      const fbRef = db
        .collection('users')
        .doc(tenantUid)
        .collection('inboxClientAttendanceFeedback')
        .doc();
      tx.set(fbRef, {
        conversationId,
        rating,
        comment: commentTrimmed.length > 0 ? commentTrimmed : null,
        inviteToken: token,
        source: 'whatsapp_link',
        createdAt: FieldValue.serverTimestamp()
      });
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'NOT_FOUND') return { ok: false, code: 'NOT_FOUND' };
    if (msg === 'USED') return { ok: false, code: 'USED' };
    if (msg === 'EXPIRED') return { ok: false, code: 'EXPIRED' };
    throw e;
  }
}

export function looksLikeSurveyToken(raw: string): boolean {
  return typeof raw === 'string' && /^[a-f0-9]+$/i.test(raw) && raw.length === SURVEY_TOKEN_HEX_LEN;
}
