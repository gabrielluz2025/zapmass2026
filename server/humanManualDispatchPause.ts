import type IORedis from 'ioredis';
import { buildPhoneDigitLookupKeys, normalizePhoneDigits } from '../src/utils/contactPhoneLookup.js';
import { getSharedRedis } from './redisShared.js';
import { normalizeOptOutPhoneSuffix, phoneMatchesJobTarget } from './contactOptOutService.js';

const localPausedByTenant = new Map<string, Set<string>>();

export function humanManualPauseRedisSetKey(tenantId: string): string {
  return `tenant:${String(tenantId || '').trim()}:human_manual_pause_set`;
}

function suffixKeysForPhone(phoneDigits: string): string[] {
  const raw = normalizePhoneDigits(phoneDigits);
  const keys = new Set<string>();
  const suffix = normalizeOptOutPhoneSuffix(raw || phoneDigits);
  if (suffix) keys.add(suffix);
  for (const k of buildPhoneDigitLookupKeys(raw)) {
    const s = normalizeOptOutPhoneSuffix(k);
    if (s) keys.add(s);
  }
  return Array.from(keys);
}

export async function markHumanManualDispatchPaused(tenantId: string, phoneDigits: string): Promise<void> {
  const tid = String(tenantId || '').trim();
  if (!tid) return;
  const keys = suffixKeysForPhone(phoneDigits);
  if (keys.length === 0) return;

  let local = localPausedByTenant.get(tid);
  if (!local) {
    local = new Set<string>();
    localPausedByTenant.set(tid, local);
  }
  for (const k of keys) local.add(k);

  const redis = getSharedRedis();
  if (!redis) return;
  try {
    const setKey = humanManualPauseRedisSetKey(tid);
    if (keys.length === 1) {
      await redis.sadd(setKey, keys[0]);
    } else {
      await redis.sadd(setKey, ...keys);
    }
  } catch (e) {
    console.warn('[humanManualPause] Falha ao gravar Redis', { tenantId: tid, error: (e as Error)?.message });
  }
}

async function isSuffixPausedInRedis(redis: IORedis, tenantId: string, suffix: string): Promise<boolean> {
  try {
    return (await redis.sismember(humanManualPauseRedisSetKey(tenantId), suffix)) === 1;
  } catch {
    return false;
  }
}

/** Contato em atendimento manual — campanha/nutrição/fluxo não devem disparar de novo. */
export async function isHumanManualDispatchPaused(tenantId: string, phoneDigits: string): Promise<boolean> {
  const tid = String(tenantId || '').trim();
  if (!tid) return false;
  const probe = normalizePhoneDigits(phoneDigits) || phoneDigits;
  const local = localPausedByTenant.get(tid);
  if (local) {
    for (const suffix of suffixKeysForPhone(probe)) {
      if (local.has(suffix)) return true;
    }
  }
  const redis = getSharedRedis();
  if (!redis) return false;
  for (const suffix of suffixKeysForPhone(probe)) {
    if (await isSuffixPausedInRedis(redis, tid, suffix)) return true;
  }
  return false;
}

/** Mesma regra de opt-out: compara variantes do número BR. */
export async function isHumanManualDispatchPausedForJob(
  tenantId: string,
  jobPhone: string,
  pausedPhone: string
): Promise<boolean> {
  if (phoneMatchesJobTarget(jobPhone, pausedPhone)) return true;
  return isHumanManualDispatchPaused(tenantId, jobPhone);
}
