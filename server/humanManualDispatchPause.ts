import type IORedis from 'ioredis';
import { buildPhoneDigitLookupKeys, normalizePhoneDigits } from '../src/utils/contactPhoneLookup.js';
import { getSharedRedis } from './redisShared.js';
import { normalizeOptOutPhoneSuffix, phoneMatchesJobTarget } from './contactOptOutService.js';

const localPausedByTenant = new Map<string, Set<string>>();

/** @deprecated Legado — membros eram só sufixo do telefone (bloqueio global). Limpo em `clearHumanManualDispatchPaused`. */
export function humanManualPauseRedisSetKey(tenantId: string): string {
  return `tenant:${String(tenantId || '').trim()}:human_manual_pause_set`;
}

/** Pausa por campanha: membro `{campaignId}:{phoneSuffix}`. */
export function humanManualPauseCampaignRedisSetKey(tenantId: string): string {
  return `tenant:${String(tenantId || '').trim()}:human_manual_pause_campaign_set`;
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

function campaignMember(campaignId: string, suffix: string): string {
  return `${String(campaignId || '').trim()}:${suffix}`;
}

function parseCampaignMember(member: string): { campaignId: string; suffix: string } | null {
  const i = member.indexOf(':');
  if (i <= 0) return null;
  const campaignId = member.slice(0, i).trim();
  const suffix = member.slice(i + 1).trim();
  if (!campaignId || !suffix) return null;
  return { campaignId, suffix };
}

function addLocalCampaignPause(tenantId: string, campaignId: string, suffixes: string[]): void {
  let local = localPausedByTenant.get(tenantId);
  if (!local) {
    local = new Set<string>();
    localPausedByTenant.set(tenantId, local);
  }
  for (const s of suffixes) {
    local.add(campaignMember(campaignId, s));
  }
}

/**
 * Marca pausa de disparo automático só para campanhas indicadas (ex.: fila cancelada ao assumir atendimento).
 * Não grava bloqueio global permanente no contato.
 */
export async function markHumanManualDispatchPausedForCampaigns(
  tenantId: string,
  phoneDigits: string,
  campaignIds: Iterable<string>
): Promise<void> {
  const tid = String(tenantId || '').trim();
  if (!tid) return;
  const suffixes = suffixKeysForPhone(phoneDigits);
  if (suffixes.length === 0) return;

  const ids = Array.from(
    new Set(
      Array.from(campaignIds)
        .map((c) => String(c || '').trim())
        .filter(Boolean)
    )
  );
  if (ids.length === 0) return;

  for (const cid of ids) {
    addLocalCampaignPause(tid, cid, suffixes);
  }

  const redis = getSharedRedis();
  if (!redis) return;
  const members: string[] = [];
  for (const cid of ids) {
    for (const s of suffixes) members.push(campaignMember(cid, s));
  }
  if (members.length === 0) return;
  try {
    const setKey = humanManualPauseCampaignRedisSetKey(tid);
    if (members.length === 1) {
      await redis.sadd(setKey, members[0]);
    } else {
      await redis.sadd(setKey, ...members);
    }
  } catch (e) {
    console.warn('[humanManualPause] Falha ao gravar Redis (campanha)', {
      tenantId: tid,
      error: (e as Error)?.message,
    });
  }
}

/** @deprecated Use `markHumanManualDispatchPausedForCampaigns` — não grava mais pausa global. */
export async function markHumanManualDispatchPaused(
  tenantId: string,
  phoneDigits: string,
  campaignIds?: Iterable<string>
): Promise<void> {
  if (campaignIds) {
    await markHumanManualDispatchPausedForCampaigns(tenantId, phoneDigits, campaignIds);
  }
}

/** Remove pausas de disparo (todas as campanhas) para o número — ex.: ao libertar conversa no inbox. */
export async function clearHumanManualDispatchPaused(tenantId: string, phoneDigits: string): Promise<void> {
  const tid = String(tenantId || '').trim();
  if (!tid) return;
  const suffixes = suffixKeysForPhone(phoneDigits);
  if (suffixes.length === 0) return;

  const local = localPausedByTenant.get(tid);
  if (local) {
    for (const member of Array.from(local)) {
      const parsed = parseCampaignMember(member);
      if (parsed && suffixes.includes(parsed.suffix)) local.delete(member);
    }
  }

  const redis = getSharedRedis();
  if (!redis) return;

  try {
    const legacyKey = humanManualPauseRedisSetKey(tid);
    for (const s of suffixes) {
      await redis.srem(legacyKey, s);
    }
  } catch {
    /* ignore */
  }

  try {
    const campaignKey = humanManualPauseCampaignRedisSetKey(tid);
    const all = await redis.smembers(campaignKey);
    const toRemove: string[] = [];
    for (const m of all) {
      const parsed = parseCampaignMember(m);
      if (parsed && suffixes.includes(parsed.suffix)) toRemove.push(m);
    }
    if (toRemove.length === 1) {
      await redis.srem(campaignKey, toRemove[0]);
    } else if (toRemove.length > 1) {
      await redis.srem(campaignKey, ...toRemove);
    }
  } catch (e) {
    console.warn('[humanManualPause] Falha ao limpar Redis', { tenantId: tid, error: (e as Error)?.message });
  }
}

async function isSuffixPausedInRedisSet(
  redis: IORedis,
  setKey: string,
  suffix: string
): Promise<boolean> {
  try {
    return (await redis.sismember(setKey, suffix)) === 1;
  } catch {
    return false;
  }
}

async function isCampaignSuffixPausedInRedis(
  redis: IORedis,
  tenantId: string,
  campaignId: string,
  suffix: string
): Promise<boolean> {
  const member = campaignMember(campaignId, suffix);
  try {
    return (await redis.sismember(humanManualPauseCampaignRedisSetKey(tenantId), member)) === 1;
  } catch {
    return false;
  }
}

/**
 * Contato com pausa de disparo na campanha indicada (atendimento manual / fila cancelada).
 * Sem `campaignId`, retorna false — não há mais bloqueio global por telefone.
 */
export async function isHumanManualDispatchPaused(
  tenantId: string,
  phoneDigits: string,
  campaignId?: string
): Promise<boolean> {
  const tid = String(tenantId || '').trim();
  const cid = String(campaignId || '').trim();
  if (!tid || !cid) return false;

  const probe = normalizePhoneDigits(phoneDigits) || phoneDigits;
  const local = localPausedByTenant.get(tid);
  if (local) {
    for (const suffix of suffixKeysForPhone(probe)) {
      if (local.has(campaignMember(cid, suffix))) return true;
    }
  }

  const redis = getSharedRedis();
  if (!redis) return false;

  for (const suffix of suffixKeysForPhone(probe)) {
    if (await isCampaignSuffixPausedInRedis(redis, tid, cid, suffix)) return true;
    // Legado: sufixo global no set antigo bloqueava todas as campanhas — ainda respeitado até clear/release.
    if (await isSuffixPausedInRedisSet(redis, humanManualPauseRedisSetKey(tid), suffix)) return true;
  }
  return false;
}

/** Mesma regra de opt-out: compara variantes do número BR. */
export async function isHumanManualDispatchPausedForJob(
  tenantId: string,
  jobPhone: string,
  pausedPhone: string,
  campaignId?: string
): Promise<boolean> {
  if (phoneMatchesJobTarget(jobPhone, pausedPhone)) return true;
  return isHumanManualDispatchPaused(tenantId, jobPhone, campaignId);
}
