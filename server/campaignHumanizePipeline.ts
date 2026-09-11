import type IORedis from 'ioredis';

export type CampaignMessageType = 'text' | 'media';

export interface HumanizeContext {
  chipId: string;
  phone: string;
  messageType: CampaignMessageType;
  contentLength: number;
  minDelayMs: number;
  maxDelayMs: number;
  tierMultiplier: number;
}

export type PresenceSender = (chipId: string, phone: string, delayMs: number) => Promise<void>;

const MICRO_REST_MIN_MS = 10 * 60_000;
const MICRO_REST_MAX_MS = 20 * 60_000;

/**
 * Calculador de atraso com distribuição Gaussiana (Box-Muller transform).
 * Evita picos em valores fixos e centraliza os tempos em uma curva natural.
 */
export function getGaussianDelayMs(minMs: number, maxMs: number, multiplier = 1): number {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  if (hi <= 0) return 0;
  if (lo === hi) return Math.round(lo * multiplier);

  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();

  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  const mean = (lo + hi) / 2;
  const stdDev = (hi - lo) / 6;
  const rawDelay = mean + z * stdDev;
  const clamped = Math.min(Math.max(rawDelay, lo), hi);
  return Math.round(clamped * Math.max(0, multiplier));
}

/** Duração de composing proporcional ao conteúdo (texto ou legenda de mídia). */
export function computeHumanizePresenceDelayMs(
  messageType: CampaignMessageType,
  contentLength: number
): number {
  const len = Math.max(0, contentLength);
  if (messageType === 'media') {
    return Math.min(Math.max(len * 50, 2000), 8000);
  }
  return Math.min(Math.max(len * 80, 1500), 12000);
}

/** Pausa longa aleatória (10–20 min) após um bloco de envios. */
export function getMicroRestDelayMs(): number {
  return MICRO_REST_MIN_MS + Math.floor(Math.random() * (MICRO_REST_MAX_MS - MICRO_REST_MIN_MS + 1));
}

function microRestBlockThreshold(): number {
  return 25 + Math.floor(Math.random() * 10) - 5;
}

/**
 * Controla blocos de envio no Redis. Retorna true quando o job atual deve ser
 * reagendado com pausa longa (10–20 min) via moveToDelayed.
 */
export async function checkAndApplyMicroRest(redis: IORedis, chipId: string): Promise<boolean> {
  const countKey = `zapmass:chip:${chipId}:block_counter`;
  const thresholdKey = `zapmass:chip:${chipId}:block_threshold`;
  const count = await redis.incr(countKey);

  if (count === 1) {
    await redis.expire(countKey, 86_400);
    await redis.set(thresholdKey, String(microRestBlockThreshold()), 'EX', 86_400);
  }

  const thresholdRaw = await redis.get(thresholdKey);
  const blockThreshold = thresholdRaw ? Number(thresholdRaw) : 25;

  if (count >= blockThreshold) {
    await redis.del(countKey, thresholdKey);
    return true;
  }
  return false;
}

/** Simula presença humana (typing/composing) antes do envio. */
export async function executePresenceSimulation(
  ctx: HumanizeContext,
  sendPresence: PresenceSender
): Promise<void> {
  const presenceDuration = computeHumanizePresenceDelayMs(ctx.messageType, ctx.contentLength);
  await sendPresence(ctx.chipId, ctx.phone, presenceDuration);
}

/** Aguarda jitter gaussiano antes do sendText/sendMedia. */
export async function applyGaussianSendDelay(ctx: HumanizeContext): Promise<void> {
  const delayMs = getGaussianDelayMs(ctx.minDelayMs, ctx.maxDelayMs, ctx.tierMultiplier);
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
