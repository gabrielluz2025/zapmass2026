import type { Queue } from 'bullmq';
import { canonicalBrazilMobileKey, normPhoneKey } from '../src/utils/brPhoneNormalize.js';
import { buildPhoneDigitLookupKeys, normalizePhoneDigits } from '../src/utils/contactPhoneLookup.js';
import { getZapmassPool, isZapmassPostgresConfigured } from './db/postgres.js';

export const INBOUND_OPT_OUT_REGEX = /^(parar|cancelar|sair|stop|descadastrar)$/i;

export const OPT_OUT_CONFIRMATION_MESSAGE =
  'Sua solicitação foi processada e você não receberá mais mensagens promocionais.';

export function matchesInboundOptOutTrigger(bodyText: string): boolean {
  const trimmed = String(bodyText || '').trim();
  if (!trimmed) return false;
  return INBOUND_OPT_OUT_REGEX.test(trimmed);
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
  return keys;
}

export function phoneMatchesJobTarget(jobPhone: string, optOutPhone: string): boolean {
  const jobKeys = phoneKeysForMatch(jobPhone);
  const optKeys = phoneKeysForMatch(optOutPhone);
  for (const k of optKeys) {
    if (jobKeys.has(k)) return true;
  }
  return false;
}

export async function registerContactOptOut(
  tenantId: string,
  phoneDigits: string,
  reason: string,
  source: string
): Promise<void> {
  const tid = String(tenantId || '').trim();
  const digits = normPhoneKey(phoneDigits) || String(phoneDigits || '').replace(/\D/g, '');
  if (!tid || digits.length < 10) return;

  if (isZapmassPostgresConfigured()) {
    const pool = getZapmassPool();
    if (pool) {
      await pool.query(
        `INSERT INTO zapmass.contact_opt_outs (tenant_id, phone_digits, reason, source)
         VALUES ($1::uuid, $2, $3, $4)
         ON CONFLICT (tenant_id, phone_digits) DO UPDATE
           SET reason = EXCLUDED.reason, source = EXCLUDED.source`,
        [tid, digits, reason.slice(0, 500), source.slice(0, 32)]
      );

      const phoneKey = normPhoneKey(digits);
      if (phoneKey) {
        await pool.query(
          `UPDATE zapmass.contacts
           SET doc = COALESCE(doc, '{}'::jsonb) || jsonb_build_object('unsubscribedAt', $3::text),
               updated_at = now()
           WHERE tenant_id = $1::uuid AND phone_key = $2`,
          [tid, phoneKey, new Date().toISOString()]
        );
      }
    }
  }
}

export async function isContactOptedOut(tenantId: string, phoneDigits: string): Promise<boolean> {
  const tid = String(tenantId || '').trim();
  const keys = [...phoneKeysForMatch(phoneDigits)];
  if (!tid || keys.length === 0) return false;
  if (!isZapmassPostgresConfigured()) return false;
  const pool = getZapmassPool();
  if (!pool) return false;
  const r = await pool.query<{ phone_digits: string }>(
    `SELECT phone_digits FROM zapmass.contact_opt_outs
     WHERE tenant_id = $1::uuid AND phone_digits = ANY($2::text[])
     LIMIT 1`,
    [tid, keys]
  );
  return r.rows.length > 0;
}

type CampaignJobData = {
  to?: string;
  ownerUid?: string;
  campaignId?: string;
};

/** Remove jobs waiting/delayed/paused para o número no tenant. */
export async function cancelCampaignJobsForPhone(
  queue: Queue<CampaignJobData>,
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
        const item = job.data || {};
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
  onComplete?: (payload: {
    tenantId: string;
    phoneDigits: string;
    jobsCancelled: number;
    keyword: string;
  }) => void;
};

/** Fluxo completo de opt-out inbound: lista negra + confirmação + cancelamento de jobs. */
export async function handleInboundOptOut(params: HandleInboundOptOutParams): Promise<boolean> {
  if (!matchesInboundOptOutTrigger(params.bodyText)) return false;

  const keyword = String(params.bodyText || '').trim();
  await registerContactOptOut(
    params.tenantId,
    params.phoneDigits,
    `Opt-out inbound: ${keyword}`,
    'inbound'
  );

  const jobsCancelled = await params.cancelJobs(params.tenantId, params.phoneDigits);

  try {
    await params.sendText(params.incomingConvId, OPT_OUT_CONFIRMATION_MESSAGE);
  } catch {
    /* confirmação best-effort */
  }

  params.onComplete?.({
    tenantId: params.tenantId,
    phoneDigits: params.phoneDigits,
    jobsCancelled,
    keyword,
  });

  return true;
}
