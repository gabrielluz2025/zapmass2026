import { getZapmassPool } from './db/postgres.js';
import { vpsDataEnabled } from './auth/dataMode.js';

/** Registro best-effort na mesma tabela da aba Acessos (ação global). */
export async function recordCommercialConfigAudit(
  admin: { uid: string; email: string },
  note: string
): Promise<void> {
  if (!vpsDataEnabled()) return;
  const pool = getZapmassPool();
  if (!pool) return;
  const trimmed = note.trim().slice(0, 2000);
  if (!trimmed) return;
  try {
    await pool.query(
      `INSERT INTO zapmass.admin_access_audit
         (target_tenant_id, target_email, admin_subject_id, admin_email, action, note)
       VALUES (NULL, '', $1, $2, 'update-commercial-config', $3)`,
      [admin.uid, admin.email, trimmed]
    );
  } catch (e) {
    console.warn('[adminCommercialConfigAudit]', e instanceof Error ? e.message : e);
  }
}
