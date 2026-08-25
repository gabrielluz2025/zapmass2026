import { createHash } from 'node:crypto';
import type IORedis from 'ioredis';
import { mergeUpdateCampaign } from './repositories/campaignsRepository.js';
import { getSharedRedis } from './redisShared.js';
import { emitAntiBanAlert } from './antiBanProactiveNotifications.js';

const KEY_PREFIX = 'msg:hash:';
const CAMPAIGN_HITS_PREFIX = 'campaign:hash_hits:';
const WINDOW_SEC = 5 * 60;
const CAMPAIGN_HITS_TTL_SEC = 600;
const DEFAULT_THRESHOLD = 10;
const DEFAULT_CAMPAIGN_VIOLATIONS = 15;
const DEFAULT_DELAY_MS = 45_000;

export type ContentHashLockResult = {
  hash: string;
  count: number;
  threshold: number;
  /** true quando count > threshold — aplicar penalidade ou falhar. */
  overLimit: boolean;
  penaltyMs: number;
};

export type CampaignContentHashAction = 'PROCEED' | 'DELAY_JOB' | 'PAUSE_CAMPAIGN';

export type ValidateCampaignContentHashResult = {
  action: CampaignContentHashAction;
  hash: string;
  count?: number;
  delayMs?: number;
  campaignViolations?: number;
};

function hashKey(tenantId: string, md5: string): string {
  return `${KEY_PREFIX}${String(tenantId || '').trim()}:${md5}`;
}

function campaignHitsKey(campaignId: string): string {
  return `${CAMPAIGN_HITS_PREFIX}${String(campaignId || '').trim()}`;
}

/** Normaliza texto para hash estável (ignora caixa e espaços extras). */
export function normalizeMessageForContentHash(text: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function md5MessageContent(text: string): string {
  const normalized = normalizeMessageForContentHash(text);
  return createHash('md5').update(normalized, 'utf8').digest('hex');
}

function readThreshold(): number {
  const n = Number(process.env.CONTENT_HASH_LOCK_THRESHOLD ?? DEFAULT_THRESHOLD);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_THRESHOLD;
}

function readPenaltyMs(): number {
  const n = Number(process.env.CONTENT_HASH_LOCK_PENALTY_MS ?? DEFAULT_DELAY_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DELAY_MS;
}

function readCampaignViolationThreshold(): number {
  const n = Number(process.env.CONTENT_HASH_CAMPAIGN_VIOLATIONS ?? DEFAULT_CAMPAIGN_VIOLATIONS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_CAMPAIGN_VIOLATIONS;
}

async function pauseCampaignForHighDuplication(
  tenantId: string,
  campaignId: string,
  hash: string,
  violations: number
): Promise<void> {
  const tid = String(tenantId || '').trim();
  const cid = String(campaignId || '').trim();
  if (!tid || !cid || cid.startsWith('nurture:')) return;

  try {
    await mergeUpdateCampaign(tid, cid, {
      status: 'PAUSED',
      pauseReason: 'PAUSED_BY_HIGH_DUPLICATION',
    });
  } catch (e) {
    console.warn('[ContentHashLock] Falha ao pausar campanha no Postgres', {
      tenantId: tid,
      campaignId: cid,
      error: (e as Error)?.message,
    });
  }

  await emitAntiBanAlert(tid, 'campaign-protection-paused', {
    campaignId: cid,
    reason: 'PAUSED_BY_HIGH_DUPLICATION',
    message: `Campanha pausada: conteúdo idêntico repetido ${violations}× em 10 min. Adicione Spintax ou varie o texto.`,
    contentHash: hash,
  });
}

/**
 * Circuit breaker por campanha: limita envios idênticos no tenant e pausa campanha após muitas violações.
 */
export async function validateCampaignContentHash(
  redis: IORedis | null | undefined,
  tenantId: string,
  campaignId: string | undefined,
  rawText: string
): Promise<ValidateCampaignContentHashResult> {
  const tid = String(tenantId || '').trim();
  const cid = String(campaignId || '').trim();
  const normalized = normalizeMessageForContentHash(rawText);
  const md5 = createHash('md5').update(normalized, 'utf8').digest('hex');
  const threshold = readThreshold();
  const delayMs = readPenaltyMs();
  const violationThreshold = readCampaignViolationThreshold();

  if (!tid || normalized.length < 8 || !cid || cid.startsWith('nurture:')) {
    return { action: 'PROCEED', hash: md5 };
  }

  const client = redis ?? getSharedRedis();
  if (!client) {
    return { action: 'PROCEED', hash: md5, count: 1 };
  }

  try {
    const key = hashKey(tid, md5);
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, WINDOW_SEC);
    }

    if (count <= threshold) {
      return { action: 'PROCEED', hash: md5, count };
    }

    const hitsKey = campaignHitsKey(cid);
    const violations = await client.incr(hitsKey);
    if (violations === 1) {
      await client.expire(hitsKey, CAMPAIGN_HITS_TTL_SEC);
    }

    console.warn('[ContentHashLock] Conteúdo idêntico acima do limite', {
      tenantId: tid,
      campaignId: cid,
      hash: md5,
      count,
      threshold,
      violations,
      violationThreshold,
    });

    if (violations >= violationThreshold) {
      await pauseCampaignForHighDuplication(tid, cid, md5, violations);
      return {
        action: 'PAUSE_CAMPAIGN',
        hash: md5,
        count,
        campaignViolations: violations,
      };
    }

    return {
      action: 'DELAY_JOB',
      hash: md5,
      count,
      delayMs,
      campaignViolations: violations,
    };
  } catch (e) {
    console.warn('[ContentHashLock] Redis indisponível — prosseguindo sem lock', {
      tenantId: tid,
      error: (e as Error)?.message,
    });
    return { action: 'PROCEED', hash: md5 };
  }
}

/**
 * @deprecated Use validateCampaignContentHash — mantido para testes legados.
 */
export async function trackContentHashLock(
  tenantId: string,
  messageText: string
): Promise<ContentHashLockResult | null> {
  const tid = String(tenantId || '').trim();
  const normalized = normalizeMessageForContentHash(messageText);
  if (!tid || normalized.length < 8) return null;

  const md5 = md5MessageContent(messageText);
  const threshold = readThreshold();
  const penaltyMs = readPenaltyMs();

  const redis = getSharedRedis();
  if (!redis) {
    return { hash: md5, count: 1, threshold, overLimit: false, penaltyMs };
  }

  const key = hashKey(tid, md5);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, WINDOW_SEC);
  }

  return {
    hash: md5,
    count,
    threshold,
    overLimit: count > threshold,
    penaltyMs,
  };
}
