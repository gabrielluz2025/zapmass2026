import type { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { canonicalBrazilMobileKey, normPhoneKey } from '../src/utils/brPhoneNormalize.js';
import { buildPhoneDigitLookupKeys, normalizePhoneDigits } from '../src/utils/contactPhoneLookup.js';
import { getZapmassPool, isZapmassPostgresConfigured } from './db/postgres.js';
import { getSharedRedis } from './redisShared.js';
import { emitAntiBanAlert } from './antiBanProactiveNotifications.js';

import { detectGlobalOptOut } from '../shared/replyFlowMatch.js';

export const INBOUND_OPT_OUT_REGEX = /^(parar|cancelar|sair|stop|descadastrar)$/i;

export const OPT_OUT_CONFIRMATION_MESSAGE =
  'Sua solicitação foi processada e você não receberá mais mensagens promocionais.';

export function optOutRedisSetKey(tenantId: string): string {
  return `tenant:${String(tenantId || '').trim()}:optout_set`;
}

/** Últimos 8 dígitos — cobre variantes do 9º dígito BR. */
export function normalizeOptOutPhoneSuffix(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 8) return digits.slice(-8);
  return digits;
}

export function matchesInboundOptOutTrigger(bodyText: string): boolean {
  const trimmed = String(bodyText || '').trim();
  if (!trimmed) return false;
  if (INBOUND_OPT_OUT_REGEX.test(trimmed)) return true;
  return detectGlobalOptOut(trimmed).matched;
}

function phoneKeysForMatch(phoneDigits: string): Set<string> {
  const keys = new Set<string>();
  const raw = normalizePhoneDigits(phoneDigits);
  if (raw) {
    keys.add(raw);
    keys.add(canonicalBrazilMobileKey(raw));
  }
  const canonical = normPhoneKey(phoneDigits) || canonicalBrazilMobileKey(raw);
  if (canonical) keys.add(canonical);
  for (const k of buildPhoneDigitLookupKeys(raw)) {
    if (k) keys.add(k);
  }
  const suffix = normalizeOptOutPhoneSuffix(raw || phoneDigits);
  if (suffix) keys.add(suffix);
  return keys;
}

export function phoneMatchesJobTarget(jobPhone: string, optOutPhone: string): boolean {
  const jobKeys = phoneKeysForMatch(jobPhone);
  const optKeys = phoneKeysForMatch(optOutPhone);
  for (const k of optKeys) {
    if (jobKeys.has(k)) return true;
  }
  const jobSuffix = normalizeOptOutPhoneSuffix(jobPhone);
  const optSuffix = normalizeOptOutPhoneSuffix(optOutPhone);
  return Boolean(jobSuffix && optSuffix && jobSuffix === optSuffix);
}

async function saddOptOutRedis(tenantId: string, phoneSuffix: string): Promise<void> {
  const redis = getSharedRedis();
  if (!redis || !phoneSuffix) return;
  try {
    await redis.sadd(optOutRedisSetKey(tenantId), phoneSuffix);
  } catch (e) {
    console.warn('[OptOut] Falha ao gravar Redis optout_set', {
      tenantId,
      phoneSuffix,
      error: (e as Error)?.message,
    });
  }
}

/** Checagem leve via Redis (fallback PG se Redis indisponível). */
export async function isContactOptedOut(
  tenantId: string,
  phoneDigits: string,
  redis?: IORedis | null
): Promise<boolean> {
  const tid = String(tenantId || '').trim();
  const suffix = normalizeOptOutPhoneSuffix(phoneDigits);
  if (!tid || suffix.length < 8) return false;

  const client = redis ?? getSharedRedis();
  if (client) {
    try {
      const member = await client.sismember(optOutRedisSetKey(tid), suffix);
      if (member === 1) return true;
    } catch (e) {
      console.warn('[OptOut] Redis SISMEMBER falhou — fallback PG', (e as Error)?.message);
    }
  }

  const keys = [...phoneKeysForMatch(phoneDigits)];
  if (keys.length === 0) return false;
  if (!isZapmassPostgresConfigured()) return false;
  const pool = getZapmassPool();
  if (!pool) return false;

  const r = await pool.query<{ phone_digits: string }>(
    `SELECT phone_digits FROM zapmass.contact_opt_outs
     WHERE tenant_id = $1::uuid
       AND (
         phone_digits = ANY($2::text[])
         OR right(regexp_replace(phone_digits, '\\D', '', 'g'), 8) = $3
       )
     LIMIT 1`,
    [tid, keys, suffix]
  );
  return r.rows.length > 0;
}

export type ProcessContactOptOutParams = {
  tenantId: string;
  phoneDigits: string;
  reason: string;
  source: string;
  keyword?: string;
  cancelJobs?: (tenantId: string, phoneDigits: string) => Promise<number>;
};

export type ProcessContactOptOutResult = {
  phoneSuffix: string;
  phoneDigits: string;
  jobsCancelled: number;
  nurtureCancelled: number;
};

/**
 * Opt-out unificado: Postgres (opt-out + contato + nurture) + Redis + purge de filas + alerta.
 */
export async function processContactOptOut(
  params: ProcessContactOptOutParams
): Promise<ProcessContactOptOutResult | null> {
  const tid = String(params.tenantId || '').trim();
  const digits = normPhoneKey(params.phoneDigits) || String(params.phoneDigits || '').replace(/\D/g, '');
  const phoneSuffix = normalizeOptOutPhoneSuffix(digits);
  if (!tid || phoneSuffix.length < 8) return null;

  const lookupKeys = [...phoneKeysForMatch(digits)];
  const nowIso = new Date().toISOString();
  let nurtureCancelled = 0;

  if (isZapmassPostgresConfigured()) {
    const pool = getZapmassPool();
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await client.query(
          `INSERT INTO zapmass.contact_opt_outs (tenant_id, phone_digits, reason, source)
           VALUES ($1::uuid, $2, $3, $4)
           ON CONFLICT (tenant_id, phone_digits) DO UPDATE
             SET reason = EXCLUDED.reason, source = EXCLUDED.source`,
          [tid, digits, params.reason.slice(0, 500), params.source.slice(0, 32)]
        );

        await client.query(
          `UPDATE zapmass.contacts
           SET doc = COALESCE(doc, '{}'::jsonb)
             || jsonb_build_object('unsubscribedAt', $3::text, 'marketingConsent', false),
               updated_at = now()
           WHERE tenant_id = $1::uuid
             AND (
               phone_key = ANY($2::text[])
               OR right(regexp_replace(coalesce(doc->>'phone', ''), '\\D', '', 'g'), 8) = $4
             )`,
          [tid, lookupKeys, nowIso, phoneSuffix]
        );

        const nurtureR = await client.query(
          `UPDATE zapmass.nurture_enrollments
           SET status = 'cancelled',
               pause_reason = 'OPT_OUT_REQUESTED',
               next_run_at = NULL,
               completed_at = now()
           WHERE tenant_id = $1::uuid
             AND status IN ('enrolled', 'active', 'waiting_reply', 'paused')
             AND (
               contact_phone = ANY($2::text[])
               OR right(regexp_replace(contact_phone, '\\D', '', 'g'), 8) = $3
             )`,
          [tid, lookupKeys, phoneSuffix]
        );
        nurtureCancelled = nurtureR.rowCount ?? 0;

        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        console.error('[OptOut] Falha na transação Postgres', {
          tenantId: tid,
          phoneSuffix,
          error: (e as Error)?.message,
        });
        throw e;
      } finally {
        client.release();
      }
    }
  }

  await saddOptOutRedis(tid, phoneSuffix);

  let jobsCancelled = 0;
  if (params.cancelJobs) {
    try {
      jobsCancelled = await params.cancelJobs(tid, digits);
    } catch (e) {
      console.warn('[OptOut] Falha ao purgar jobs BullMQ', {
        tenantId: tid,
        error: (e as Error)?.message,
      });
    }
  }

  await emitAntiBanAlert(tid, 'contact-marketing-consent', {
    phoneDigits: digits,
    phoneSuffix,
    effect: 'opt_out',
    replyText: params.keyword || params.reason.slice(0, 120),
    jobsCancelled,
    nurtureCancelled,
  });

  console.log('[OptOut] processContactOptOut concluído', {
    tenantId: tid,
    phoneSuffix,
    jobsCancelled,
    nurtureCancelled,
    source: params.source,
  });

  return { phoneSuffix, phoneDigits: digits, jobsCancelled, nurtureCancelled };
}

/** @deprecated Use processContactOptOut */
export async function registerContactOptOut(
  tenantId: string,
  phoneDigits: string,
  reason: string,
  source: string
): Promise<void> {
  await processContactOptOut({ tenantId, phoneDigits, reason, source });
}

type QueueJobPayload = {
  to?: string;
  ownerUid?: string;
  campaignId?: string;
  nurtureFollowUp?: boolean;
};

/** Remove jobs waiting/delayed/paused para o número no tenant (campanha + nurture na mesma fila). */
export async function cancelCampaignJobsForPhone<T extends QueueJobPayload>(
  queue: Queue<T>,
  tenantId: string,
  phoneDigits: string,
  resolveOwnerUid?: (campaignId: string) => string | undefined
): Promise<number> {
  const tid = String(tenantId || '').trim();
  if (!tid) return 0;

  let removed = 0;
  const states: Array<'waiting' | 'delayed' | 'paused'> = ['waiting', 'delayed', 'paused'];
  const pageSize = 200;

  for (const state of states) {
    let start = 0;
    while (true) {
      const batch = await queue.getJobs([state], start, start + pageSize - 1, true);
      if (batch.length === 0) break;

      for (const job of batch) {
        const item = job.data || ({} as T);
        const jobOwner =
          String(item.ownerUid || '').trim() ||
          (item.campaignId && resolveOwnerUid ? resolveOwnerUid(item.campaignId) : '');
        if (jobOwner !== tid) continue;
        if (!item.to || !phoneMatchesJobTarget(item.to, phoneDigits)) continue;
        try {
          await job.remove();
          removed += 1;
        } catch {
          /* job ativo ou lock — ignorar */
        }
      }

      if (batch.length < pageSize) break;
      start += pageSize;
    }
  }

  return removed;
}

export type HandleInboundOptOutParams = {
  tenantId: string;
  connectionId: string;
  phoneDigits: string;
  bodyText: string;
  incomingConvId: string;
  sendText: (conversationId: string, text: string) => Promise<void>;
  cancelJobs: (tenantId: string, phoneDigits: string) => Promise<number>;
  /** Se informado, substitui a confirmação genérica LGPD (ex.: texto do gatilho SAIR da campanha). */
  confirmationMessage?: string;
  onComplete?: (payload: {
    tenantId: string;
    phoneDigits: string;
    jobsCancelled: number;
    keyword: string;
    nurtureCancelled?: number;
  }) => void;
};

/** Fluxo completo de opt-out inbound: lista negra + confirmação + cancelamento de jobs. */
export async function handleInboundOptOut(params: HandleInboundOptOutParams): Promise<boolean> {
  if (!matchesInboundOptOutTrigger(params.bodyText)) return false;

  const already = await isContactOptedOut(params.tenantId, params.phoneDigits);
  if (already) {
    // Replay/webhook duplicado após deploy — não manda a confirmação de novo.
    return true;
  }

  const keyword = String(params.bodyText || '').trim();
  const result = await processContactOptOut({
    tenantId: params.tenantId,
    phoneDigits: params.phoneDigits,
    reason: `Opt-out inbound: ${keyword}`,
    source: 'inbound',
    keyword,
    cancelJobs: params.cancelJobs,
  });

  const confirmation = String(params.confirmationMessage || '').trim() || OPT_OUT_CONFIRMATION_MESSAGE;
  try {
    await params.sendText(params.incomingConvId, confirmation);
  } catch {
    /* confirmação best-effort */
  }

  params.onComplete?.({
    tenantId: params.tenantId,
    phoneDigits: params.phoneDigits,
    jobsCancelled: result?.jobsCancelled ?? 0,
    nurtureCancelled: result?.nurtureCancelled,
    keyword,
  });

  return true;
}

/** Popula Redis optout_set a partir do Postgres (startup / script manual). */
export async function warmupOptOutCacheForTenant(tenantId: string): Promise<number> {
  const tid = String(tenantId || '').trim();
  if (!tid || !isZapmassPostgresConfigured()) return 0;
  const pool = getZapmassPool();
  const redis = getSharedRedis();
  if (!pool || !redis) return 0;

  const r = await pool.query<{ suffix: string }>(
    `SELECT DISTINCT right(regexp_replace(phone_digits, '\\D', '', 'g'), 8) AS suffix
     FROM zapmass.contact_opt_outs
     WHERE tenant_id = $1::uuid`,
    [tid]
  );

  const key = optOutRedisSetKey(tid);
  let added = 0;
  for (const row of r.rows) {
    const suffix = String(row.suffix || '').trim();
    if (suffix.length < 8) continue;
    try {
      await redis.sadd(key, suffix);
      added += 1;
    } catch {
      /* continuar */
    }
  }
  return added;
}

export async function warmupOptOutCacheAllTenants(): Promise<{ tenants: number; members: number }> {
  if (!isZapmassPostgresConfigured()) return { tenants: 0, members: 0 };
  const pool = getZapmassPool();
  if (!pool) return { tenants: 0, members: 0 };

  const r = await pool.query<{ tenant_id: string }>(
    `SELECT DISTINCT tenant_id::text FROM zapmass.contact_opt_outs`
  );

  let members = 0;
  for (const row of r.rows) {
    members += await warmupOptOutCacheForTenant(row.tenant_id);
  }
  return { tenants: r.rows.length, members };
}
