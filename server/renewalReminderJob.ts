/**
 * Cron diário: lembrete de renovação 7 dias antes do accessEndsAt.
 */
import { isZapmassPostgresConfigured, getZapmassPool } from './db/postgres.js';
import { findUserById } from './auth/userRepository.js';
import { sendSubscriptionRenewalReminderEmail } from './emailService.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function publicAppUrl(): string {
  return (process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || 'https://zap-mass.com').replace(/\/+$/, '');
}

async function runRenewalReminders(): Promise<void> {
  if (!isZapmassPostgresConfigured()) return;
  const pool = getZapmassPool();
  if (!pool) return;

  try {
    const r = await pool.query<{ tenant_id: string; access_ends_at: Date }>(
      `SELECT tenant_id::text AS tenant_id,
              (doc->>'accessEndsAt')::timestamptz AS access_ends_at
         FROM zapmass.user_subscriptions
        WHERE doc->>'accessEndsAt' IS NOT NULL
          AND (doc->>'accessEndsAt')::timestamptz > NOW()
          AND (doc->>'accessEndsAt')::timestamptz <= NOW() + INTERVAL '8 days'
          AND (doc->>'accessEndsAt')::timestamptz >= NOW() + INTERVAL '6 days'`
    );

    for (const row of r.rows) {
      const tenantId = row.tenant_id;
      const ends = new Date(row.access_ends_at);
      const dedupe = await pool.query(
        `SELECT 1 FROM zapmass.renewal_reminder_log WHERE tenant_id = $1::uuid AND access_ends_at = $2`,
        [tenantId, ends]
      );
      if (dedupe.rowCount && dedupe.rowCount > 0) continue;

      const user = await findUserById(tenantId);
      const email = (user?.email || '').trim();
      if (!email) continue;

      const sent = await sendSubscriptionRenewalReminderEmail({
        to: email,
        name: user?.display_name || undefined,
        accessEndsAt: ends,
        subscriptionUrl: `${publicAppUrl()}/?view=subscription`,
      });
      if (sent) {
        await pool.query(
          `INSERT INTO zapmass.renewal_reminder_log (tenant_id, access_ends_at) VALUES ($1::uuid, $2)
           ON CONFLICT DO NOTHING`,
          [tenantId, ends]
        );
        console.log('[RenewalReminder] enviado para', email);
      }
    }
  } catch (e) {
    console.error('[RenewalReminder] erro:', (e as Error)?.message);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startRenewalReminderJob(): void {
  if (timer) return;
  void runRenewalReminders();
  timer = setInterval(() => void runRenewalReminders(), DAY_MS);
}

export function stopRenewalReminderJob(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
