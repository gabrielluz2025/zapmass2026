import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { structuredLog } from './structuredLog.js';

const SUMMARY_DOC = 'summary';

/** Acumula tempo ativo na conta (dono do workspace). Escrita só pelo servidor. */
export async function incrementTenantUsageMs(tenantUid: string, deltaMs: number): Promise<void> {
  if (!tenantUid || tenantUid === 'anonymous') return;
  const n = Math.round(deltaMs);
  if (!Number.isFinite(n) || n < 1) return;

  const admin = getFirebaseAdmin();
  if (!admin) return;

  try {
    const db = getFirestore(admin);
    const ref = db.collection('users').doc(tenantUid).collection('usageStats').doc(SUMMARY_DOC);
    await ref.set(
      {
        totalActiveMs: FieldValue.increment(n),
        lastActiveAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  } catch (e) {
    structuredLog('warn', 'usage_stats.increment_failed', {
      tenantUid,
      message: e instanceof Error ? e.message : String(e)
    });
  }
}
