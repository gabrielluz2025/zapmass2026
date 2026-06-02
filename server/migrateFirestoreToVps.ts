/**
 * Migração única Firestore → Postgres (modo VPS).
 * Requer Firebase Admin + ZAPMASS_DATABASE_URL.
 *
 *   npx tsx server/migrateFirestoreToVps.ts [--dry-run] [--uid=FIREBASE_UID]
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { readdir, rename } from 'fs/promises';
import path from 'path';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { hashPassword } from './auth/password.js';
import { firebaseUidToTenantUuid, isUuid } from './auth/firebaseUidMap.js';
import { runZapmassMigrations } from './db/migrate.js';
import { getZapmassPool } from './db/postgres.js';
import { mergeAppConfigPartial, type AppConfigGlobal } from './appConfigStore.js';
import { saveAppConfigPg } from './repositories/appConfigRepository.js';
import { appendChatArchiveMessagesPg } from './repositories/chatArchiveRepository.js';
import type { ChatMessage } from './types.js';

process.env.ZAPMASS_DATA_PROVIDER = process.env.ZAPMASS_DATA_PROVIDER || 'vps';

type Flags = { dryRun: boolean; uidFilter: string | null };

function parseFlags(): Flags {
  const args = process.argv.slice(2);
  let dryRun = false;
  let uidFilter: string | null = null;
  for (const a of args) {
    if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--uid=')) uidFilter = a.slice('--uid='.length).trim() || null;
  }
  return { dryRun, uidFilter };
}

function tsToIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof (v as Timestamp).toDate === 'function') {
    try {
      return (v as Timestamp).toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
  return null;
}

function firestoreDocToPlain(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v instanceof Timestamp) out[k] = v.toDate().toISOString();
    else if (v && typeof v === 'object' && 'toDate' in (v as object)) {
      try {
        out[k] = (v as { toDate: () => Date }).toDate().toISOString();
      } catch {
        out[k] = v;
      }
    } else out[k] = v;
  }
  return out;
}

async function collectTenantFirebaseUids(db: Firestore): Promise<string[]> {
  const set = new Set<string>();
  const subSnap = await db.collection('userSubscriptions').get();
  for (const d of subSnap.docs) set.add(d.id);

  const usersSnap = await db.collection('users').get();
  for (const d of usersSnap.docs) set.add(d.id);

  return [...set].filter(Boolean).sort();
}

async function ensureOwnerUser(
  admin: ReturnType<typeof getFirebaseAdmin>,
  fbUid: string,
  tenantUuid: string,
  dryRun: boolean
): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');

  const existing = await pool.query(`SELECT 1 FROM zapmass.users WHERE id = $1::uuid`, [tenantUuid]);
  if (existing.rowCount && existing.rowCount > 0) return;

  let email = `migrated+${fbUid.slice(0, 12)}@zapmass.local`;
  let displayName: string | null = null;
  if (admin) {
    try {
      const u = await getAuth(admin).getUser(fbUid);
      if (u.email) email = u.email;
      displayName = u.displayName || null;
    } catch {
      /* utilizador só no Firestore */
    }
  }
  const norm = email.trim().toLowerCase();
  if (dryRun) {
    console.log(`[dry-run] user ${fbUid} → ${tenantUuid} (${email})`);
    return;
  }
  await pool.query(
    `INSERT INTO zapmass.users (id, email, email_normalized, display_name, firebase_uid)
     VALUES ($1::uuid, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       firebase_uid = COALESCE(zapmass.users.firebase_uid, EXCLUDED.firebase_uid),
       display_name = COALESCE(EXCLUDED.display_name, zapmass.users.display_name)`,
    [tenantUuid, email, norm, displayName, fbUid]
  );
  console.log(`[user] ${fbUid} → ${tenantUuid}`);
}

async function migrateTenant(
  db: Firestore,
  admin: ReturnType<typeof getFirebaseAdmin>,
  fbUid: string,
  dryRun: boolean
): Promise<void> {
  const tenantUuid = firebaseUidToTenantUuid(fbUid);
  const pool = getZapmassPool();
  if (!pool) throw new Error('POSTGRES_UNAVAILABLE');

  console.log(`\n==> tenant ${fbUid} (${tenantUuid})`);
  await ensureOwnerUser(admin, fbUid, tenantUuid, dryRun);

  const userRef = db.collection('users').doc(fbUid);

  const subSnap = await db.collection('userSubscriptions').doc(fbUid).get();
  if (subSnap.exists && !dryRun) {
    const doc = firestoreDocToPlain(subSnap.data() as Record<string, unknown>);
    await pool.query(
      `INSERT INTO zapmass.user_subscriptions (tenant_id, doc, updated_at)
       VALUES ($1::uuid, $2::jsonb, now())
       ON CONFLICT (tenant_id) DO UPDATE SET doc = $2::jsonb, updated_at = now()`,
      [tenantUuid, JSON.stringify(doc)]
    );
    console.log('  subscription OK');
  } else if (subSnap.exists) {
    console.log('  [dry-run] subscription');
  }

  const contactsSnap = await userRef.collection('contacts').get();
  if (!dryRun && contactsSnap.size > 0) {
    for (const doc of contactsSnap.docs) {
      const data = doc.data();
      const name = String(data.name || 'Sem Nome').slice(0, 500);
      const phone = String(data.phone || '').slice(0, 64);
      const sortName = String(data.sortName || name).toLowerCase();
      const id = isUuid(doc.id) ? doc.id : randomUUID();
      const payload = firestoreDocToPlain({ ...data, legacyFirestoreId: doc.id });
      await pool.query(
        `INSERT INTO zapmass.contacts (id, tenant_id, name, phone, sort_name, doc)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [id, tenantUuid, name, phone, sortName, JSON.stringify(payload)]
      );
    }
    console.log(`  contacts ${contactsSnap.size}`);
  } else if (contactsSnap.size) {
    console.log(`  [dry-run] contacts ${contactsSnap.size}`);
  }

  const listsSnap = await userRef.collection('contactLists').get();
  if (!dryRun && listsSnap.size > 0) {
    for (const doc of listsSnap.docs) {
      const data = doc.data();
      const id = isUuid(doc.id) ? doc.id : randomUUID();
      await pool.query(
        `INSERT INTO zapmass.contact_lists (id, tenant_id, name, contact_ids, description, tags)
         VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5, $6::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [
          id,
          tenantUuid,
          String(data.name || '').slice(0, 500),
          JSON.stringify(data.contactIds || data.contact_ids || []),
          data.description ? String(data.description) : null,
          data.tags ? JSON.stringify(data.tags) : null
        ]
      );
    }
    console.log(`  contact_lists ${listsSnap.size}`);
  }

  const campaignsSnap = await userRef.collection('campaigns').get();
  for (const cDoc of campaignsSnap.docs) {
    const data = cDoc.data();
    const campaignId = isUuid(cDoc.id) ? cDoc.id : randomUUID();
    const docPayload = firestoreDocToPlain({ ...data, legacyFirestoreId: cDoc.id });
    const status = String(data.status || 'DRAFT');
    const nextRun = tsToIso(data.nextRunAt ?? data.scheduledAt);
    if (!dryRun) {
      await pool.query(
        `INSERT INTO zapmass.campaigns (id, tenant_id, name, status, next_run_at, doc)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6::jsonb)
         ON CONFLICT (id) DO UPDATE SET doc = $6::jsonb, status = $4, updated_at = now()`,
        [
          campaignId,
          tenantUuid,
          String(data.name || '').slice(0, 500),
          status,
          nextRun,
          JSON.stringify(docPayload)
        ]
      );
      const logsSnap = await cDoc.ref.collection('logs').get();
      for (const lDoc of logsSnap.docs) {
        const ld = lDoc.data();
        await pool.query(
          `INSERT INTO zapmass.campaign_logs (id, campaign_id, tenant_id, level, message, payload)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb)
           ON CONFLICT (id) DO NOTHING`,
          [
            randomUUID(),
            campaignId,
            tenantUuid,
            String(ld.level || 'INFO'),
            String(ld.message || '').slice(0, 4000),
            JSON.stringify(firestoreDocToPlain(ld))
          ]
        );
      }
    }
  }
  if (campaignsSnap.size) console.log(`  campaigns ${campaignsSnap.size}`);

  const notifSnap = await userRef.collection('notifications').get();
  if (!dryRun && notifSnap.size > 0) {
    for (const doc of notifSnap.docs) {
      const d = doc.data();
      await pool.query(
        `INSERT INTO zapmass.tenant_notifications
         (tenant_id, title, body, kind, category, read, campaign_id, created_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()))`,
        [
          tenantUuid,
          String(d.title || ''),
          String(d.body || d.message || ''),
          String(d.kind || 'info'),
          String(d.category || 'other'),
          d.read === true,
          d.campaignId ? String(d.campaignId) : null,
          tsToIso(d.createdAt)
        ]
      );
    }
    console.log(`  notifications ${notifSnap.size}`);
  }

  const dispatchSnap = await userRef.collection('settings').doc('dispatch').get();
  if (dispatchSnap.exists && !dryRun) {
    await pool.query(
      `INSERT INTO zapmass.tenant_dispatch_settings (tenant_id, doc, updated_at)
       VALUES ($1::uuid, $2::jsonb, now())
       ON CONFLICT (tenant_id) DO UPDATE SET doc = $2::jsonb, updated_at = now()`,
      [tenantUuid, JSON.stringify(firestoreDocToPlain(dispatchSnap.data() as Record<string, unknown>))]
    );
    console.log('  dispatch_settings OK');
  }

  const profileSnap = await userRef.collection('appProfile').doc('segment').get();
  if (!profileSnap.exists) {
    const alt = await userRef.collection('settings').doc('appProfile').get();
    if (alt.exists && !dryRun) {
      const d = alt.data() || {};
      await pool.query(
        `INSERT INTO zapmass.tenant_app_profiles (tenant_id, use_segment, updated_at)
         VALUES ($1::uuid, $2, now())
         ON CONFLICT (tenant_id) DO UPDATE SET use_segment = $2, updated_at = now()`,
        [tenantUuid, typeof d.useSegment === 'string' ? d.useSegment : null]
      );
    }
  } else if (!dryRun) {
    const d = profileSnap.data() || {};
    await pool.query(
      `INSERT INTO zapmass.tenant_app_profiles (tenant_id, use_segment, updated_at)
       VALUES ($1::uuid, $2, now())
       ON CONFLICT (tenant_id) DO UPDATE SET use_segment = $2, updated_at = now()`,
      [tenantUuid, typeof d.useSegment === 'string' ? d.useSegment : null]
    );
  }

  const usageSnap = await userRef.collection('usageStats').doc('summary').get();
  if (usageSnap.exists && !dryRun) {
    const d = usageSnap.data() || {};
    await pool.query(
      `INSERT INTO zapmass.tenant_usage_stats (tenant_id, total_active_ms, last_active_at, updated_at)
       VALUES ($1::uuid, $2, $3::timestamptz, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         total_active_ms = GREATEST(zapmass.tenant_usage_stats.total_active_ms, EXCLUDED.total_active_ms),
         last_active_at = COALESCE(EXCLUDED.last_active_at, zapmass.tenant_usage_stats.last_active_at),
         updated_at = now()`,
      [
        tenantUuid,
        Math.max(0, Number(d.totalActiveMs) || 0),
        tsToIso(d.lastActiveAt)
      ]
    );
  }

  const sugSnap = await userRef.collection('suggestions').get();
  if (!dryRun && sugSnap.size > 0) {
    for (const doc of sugSnap.docs) {
      const d = doc.data();
      await pool.query(
        `INSERT INTO zapmass.product_suggestions
         (tenant_id, actor_subject_id, email, text, screen, category, created_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
        [
          tenantUuid,
          String(d.actorUid || fbUid),
          String(d.email || ''),
          String(d.text || d.message || ''),
          String(d.screen || ''),
          String(d.category || 'other'),
          tsToIso(d.createdAt)
        ]
      );
    }
    console.log(`  suggestions ${sugSnap.size}`);
  }

  const threadsSnap = await userRef.collection('waChatThreads').get();
  for (const tDoc of threadsSnap.docs) {
    const tData = tDoc.data();
    const threadId = tDoc.id;
    const meta = {
      contactName: String(tData.contactName || ''),
      contactPhone: String(tData.contactPhone || ''),
      connectionId: String(tData.lastConnectionId || tData.connectionId || '')
    };
    const msgSnap = await tDoc.ref.collection('messages').limit(500).get();
    const messages: ChatMessage[] = msgSnap.docs.map((m) => {
      const md = m.data();
      return {
        id: m.id,
        text: String(md.text || ''),
        timestamp: String(md.timestamp || ''),
        sender: md.sender === 'me' ? 'me' : 'them',
        status: 'sent',
        type: 'text',
        timestampMs: Number(md.timestampMs) || Date.now()
      } as ChatMessage;
    });
    if (!dryRun && messages.length > 0) {
      await appendChatArchiveMessagesPg(tenantUuid, threadId, meta, messages);
    }
  }
  if (threadsSnap.size) console.log(`  chat_threads ${threadsSnap.size}`);

  const assignSnap = await userRef.collection('inboxAssignments').get();
  if (!dryRun && assignSnap.size > 0) {
    for (const doc of assignSnap.docs) {
      const d = doc.data();
      let claimedBy = String(d.claimedBy || d.staffUid || '');
      if (claimedBy && !isUuid(claimedBy)) {
        const r = await pool.query<{ id: string }>(
          `SELECT id::text FROM zapmass.workspace_members WHERE firebase_auth_uid = $1`,
          [claimedBy]
        );
        if (r.rows[0]) claimedBy = r.rows[0].id;
      }
      await pool.query(
        `INSERT INTO zapmass.inbox_assignments
         (tenant_id, conversation_id, claimed_by_subject_id, connection_id, claimed_at)
         VALUES ($1::uuid, $2, $3, $4, COALESCE($5::timestamptz, now()))
         ON CONFLICT (tenant_id, conversation_id) DO UPDATE SET
           claimed_by_subject_id = EXCLUDED.claimed_by_subject_id`,
        [
          tenantUuid,
          doc.id,
          claimedBy,
          String(d.connectionId || ''),
          tsToIso(d.claimedAt)
        ]
      );
    }
    console.log(`  inbox_assignments ${assignSnap.size}`);
  }

  const feedbackSnap = await userRef.collection('inboxClientAttendanceFeedback').get();
  if (!dryRun && feedbackSnap.size > 0) {
    for (const doc of feedbackSnap.docs) {
      const d = doc.data();
      await pool.query(
        `INSERT INTO zapmass.inbox_attendance_feedback
         (tenant_id, conversation_id, actor_subject_id, assigned_to_subject_id, rating, comment, skipped_survey, created_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()))`,
        [
          tenantUuid,
          String(d.conversationId || doc.id),
          String(d.actorUid || ''),
          d.assignedTo ? String(d.assignedTo) : null,
          typeof d.rating === 'number' ? d.rating : null,
          d.comment ? String(d.comment) : null,
          d.skippedSurvey === true,
          tsToIso(d.createdAt)
        ]
      );
    }
  }

  const staffSnap = await userRef.collection('staffPasswordUsers').get();
  const linksSnap = await db.collection('userWorkspaceLinks').where('ownerUid', '==', fbUid).get();
  const slugByStaffFb = new Map<string, string>();
  if (admin) {
    for (const lk of linksSnap.docs) {
      if (lk.id === fbUid) continue;
      try {
        const u = await getAuth(admin).getUser(lk.id);
        const email = u.email || '';
        const m = email.match(
          new RegExp(`zapm\\.staff\\.${fbUid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.([a-z0-9_]{3,28})@`)
        );
        if (m?.[1]) slugByStaffFb.set(lk.id, m[1]);
      } catch {
        /* ignore */
      }
    }
  }
  if (staffSnap.size > 0) {
    const placeholderHash = dryRun ? '' : await hashPassword(randomUUID());
    for (const doc of staffSnap.docs) {
      const d = doc.data();
      if (d.revoked === true) continue;
      const slug = doc.id;
      let staffFbUid: string | null = null;
      for (const [sfUid, sl] of slugByStaffFb) {
        if (sl === slug) {
          staffFbUid = sfUid;
          break;
        }
      }
      if (!dryRun) {
        await pool.query(
          `INSERT INTO zapmass.workspace_members
           (id, owner_user_id, login_slug, password_hash, display_name, firebase_auth_uid)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
           ON CONFLICT (owner_user_id, login_slug) DO UPDATE SET
             display_name = EXCLUDED.display_name,
             firebase_auth_uid = COALESCE(zapmass.workspace_members.firebase_auth_uid, EXCLUDED.firebase_auth_uid)`,
          [
            randomUUID(),
            tenantUuid,
            slug,
            placeholderHash,
            String(d.displayName || slug),
            staffFbUid
          ]
        );
      }
    }
    console.log(
      `  staff ${staffSnap.size} (redefina senhas na Equipe para login VPS; dual mantém Firebase)`
    );
  }

  if (!dryRun) await renameConnectionPrefixes(fbUid, tenantUuid);
}

async function migrateGlobal(db: Firestore, dryRun: boolean): Promise<void> {
  const snap = await db.collection('appConfig').doc('global').get();
  if (!snap.exists) return;
  const merged = mergeAppConfigPartial(snap.data() as Record<string, unknown>);
  if (dryRun) {
    console.log('[dry-run] app_config_global');
    return;
  }
  await saveAppConfigPg(merged as AppConfigGlobal);
  console.log('[global] app_config OK');
}

async function migrateAdminAudit(db: Firestore, dryRun: boolean): Promise<void> {
  const pool = getZapmassPool();
  if (!pool) return;
  const snap = await db.collection('adminAccessAudit').orderBy('createdAt', 'desc').limit(2000).get();
  if (snap.empty) return;
  for (const doc of snap.docs) {
    const d = doc.data();
    const targetFb = String(d.targetUid || '');
    const tenantId = targetFb ? firebaseUidToTenantUuid(targetFb) : null;
    if (dryRun) continue;
    await pool.query(
      `INSERT INTO zapmass.admin_access_audit
       (target_tenant_id, target_email, admin_subject_id, admin_email, action, note, created_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
      [
        tenantId,
        String(d.targetEmail || ''),
        String(d.adminUid || ''),
        String(d.adminEmail || ''),
        String(d.action || 'update'),
        String(d.note || ''),
        tsToIso(d.createdAt)
      ]
    );
  }
  console.log(`[global] admin_access_audit ${snap.size}`);
}

async function renameConnectionPrefixes(oldUid: string, newUid: string): Promise<void> {
  if (oldUid === newUid) return;
  const dataDir = path.join(process.cwd(), 'data');
  let entries: string[];
  try {
    entries = await readdir(dataDir);
  } catch {
    return;
  }
  const prefix = `${oldUid}__`;
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue;
    const next = `${newUid}__${name.slice(prefix.length)}`;
    try {
      await rename(path.join(dataDir, name), path.join(dataDir, next));
      console.log(`  [data] ${name} → ${next}`);
    } catch (e) {
      console.warn(`  [data] falha ao renomear ${name}:`, (e as Error).message);
    }
  }
}

async function main(): Promise<void> {
  const { dryRun, uidFilter } = parseFlags();
  const admin = getFirebaseAdmin();
  if (!admin) {
    console.error('Firebase Admin não configurado (FIREBASE_SERVICE_ACCOUNT_PATH).');
    process.exit(1);
  }
  if (!getZapmassPool()) {
    console.error('ZAPMASS_DATABASE_URL inválida ou Postgres indisponível.');
    process.exit(1);
  }

  await runZapmassMigrations();
  const db = getFirestore(admin);

  console.log(`Migração Firestore → Postgres${dryRun ? ' (dry-run)' : ''}`);
  await migrateGlobal(db, dryRun);
  await migrateAdminAudit(db, dryRun);

  let uids = await collectTenantFirebaseUids(db);
  if (uidFilter) uids = uids.filter((u) => u === uidFilter);
  if (uidFilter && uids.length === 0) uids = [uidFilter];

  for (const fbUid of uids) {
    await migrateTenant(db, admin, fbUid, dryRun);
  }

  console.log('\nConcluído. Ative no .env: ZAPMASS_DATA_PROVIDER=vps e VITE_USE_VPS_DATA=true');
  console.log('Auth recomendado em produção: ZAPMASS_AUTH_PROVIDER=dual (Google/Facebook + VPS).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
