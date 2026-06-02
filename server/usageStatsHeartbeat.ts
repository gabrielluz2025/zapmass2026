import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { structuredLog } from './structuredLog.js';

const SUMMARY_DOC = 'summary';

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

/** Acumula tempo ativo na conta (dono do workspace). Escrita só pelo servidor. */
export async function incrementTenantUsageMs(tenantUid: string, deltaMs: number): Promise<void> {
  if (!tenantUid || tenantUid === 'anonymous') return;
  const n = Math.round(deltaMs);
  if (!Number.isFinite(n) || n < 1) return;

  if (vpsDataEnabled() && isUuid(tenantUid)) {
    const pool = getZapmassPool();
    if (!pool) return;
    try {
      await pool.query(
        `INSERT INTO zapmass.tenant_usage_stats (tenant_id, total_active_ms, last_active_at, updated_at)
         VALUES ($1::uuid, $2, now(), now())
         ON CONFLICT (tenant_id) DO UPDATE SET
           total_active_ms = zapmass.tenant_usage_stats.total_active_ms + $2,
           last_active_at = now(),
           updated_at = now()`,
        [tenantUid, n]
      );
    } catch (e) {
      structuredLog('warn', 'usage_stats.increment_failed', {
        tenantUid,
        message: e instanceof Error ? e.message : String(e)
      });
    }
    return;
  }

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
