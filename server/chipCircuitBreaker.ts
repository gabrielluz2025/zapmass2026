import { getSharedRedis } from './redisShared.js';

export type CircuitEventType = 'SENT' | 'DELIVERED_ACK' | 'FAIL_4XX';

export type CircuitState = 'OPEN' | 'HALF_OPEN' | 'CLOSED';

export type CircuitHealthScore = {
  state: CircuitState;
  sent: number;
  delivered: number;
  failures: number;
  failRate: number;
  windowMs: number;
};

const WINDOW_MS = 5 * 60 * 1000;
const KEY_PREFIX = 'chip:cb:';

/** Limites configuráveis via env. */
function thresholds() {
  return {
    openFailCount: Number(process.env.CHIP_CB_OPEN_FAIL_COUNT ?? 5),
    openFailRate: Number(process.env.CHIP_CB_OPEN_FAIL_RATE ?? 0.35),
    halfOpenFailRate: Number(process.env.CHIP_CB_HALF_FAIL_RATE ?? 0.15),
    minSamples: Number(process.env.CHIP_CB_MIN_SAMPLES ?? 8),
  };
}

function zkey(chipId: string, event: CircuitEventType): string {
  return `${KEY_PREFIX}${chipId}:${event}`;
}

const COUNT_LUA = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local minScore = now - window
for i = 1, 3 do
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', minScore)
end
return {
  redis.call('ZCARD', KEYS[1]),
  redis.call('ZCARD', KEYS[2]),
  redis.call('ZCARD', KEYS[3])
}
`;

export class ChipCircuitBreaker {
  private readonly windowMs: number;

  constructor(windowMs = WINDOW_MS) {
    this.windowMs = windowMs;
  }

  private keys(chipId: string): [string, string, string] {
    const id = String(chipId || '').trim();
    return [zkey(id, 'SENT'), zkey(id, 'DELIVERED_ACK'), zkey(id, 'FAIL_4XX')];
  }

  async recordEvent(chipId: string, event: CircuitEventType): Promise<void> {
    const redis = getSharedRedis();
    const id = String(chipId || '').trim();
    if (!redis || !id) return;

    const keys = this.keys(id);
    const member = `${event}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const idx = event === 'SENT' ? 1 : event === 'DELIVERED_ACK' ? 2 : 3;

    const pipeline = redis.pipeline();
    const minScore = Date.now() - this.windowMs;
    pipeline.zadd(keys[idx - 1], Date.now(), member);
    pipeline.zremrangebyscore(keys[0], '-inf', minScore);
    pipeline.zremrangebyscore(keys[1], '-inf', minScore);
    pipeline.zremrangebyscore(keys[2], '-inf', minScore);
    await pipeline.exec();
  }

  async recordSent(chipId: string): Promise<void> {
    await this.recordEvent(chipId, 'SENT');
  }

  async recordDeliveredAck(chipId: string): Promise<void> {
    await this.recordEvent(chipId, 'DELIVERED_ACK');
  }

  async recordFail4xx(chipId: string): Promise<void> {
    await this.recordEvent(chipId, 'FAIL_4XX');
  }

  classifyCounts(sent: number, delivered: number, failures: number): CircuitHealthScore {
    const t = thresholds();
    const samples = sent + failures;
    const failRate = samples > 0 ? failures / samples : 0;

    let state: CircuitState = 'CLOSED';
    if (failures >= t.openFailCount || (samples >= t.minSamples && failRate >= t.openFailRate)) {
      state = 'OPEN';
    } else if (samples >= t.minSamples && failRate >= t.halfOpenFailRate) {
      state = 'HALF_OPEN';
    }

    return {
      state,
      sent,
      delivered,
      failures,
      failRate,
      windowMs: this.windowMs,
    };
  }

  async getHealthScore(chipId: string): Promise<CircuitHealthScore> {
    const redis = getSharedRedis();
    const id = String(chipId || '').trim();
    if (!redis || !id) {
      return { state: 'CLOSED', sent: 0, delivered: 0, failures: 0, failRate: 0, windowMs: this.windowMs };
    }

    const keys = this.keys(id);
    const now = Date.now();
    const raw = (await redis.eval(
      COUNT_LUA,
      3,
      keys[0],
      keys[1],
      keys[2],
      String(now),
      String(this.windowMs)
    )) as number[];

    const sent = Number(raw[0]) || 0;
    const delivered = Number(raw[1]) || 0;
    const failures = Number(raw[2]) || 0;
    return this.classifyCounts(sent, delivered, failures);
  }

  isUsable(score: CircuitHealthScore): boolean {
    return score.state !== 'OPEN';
  }

  delayMultiplier(score: CircuitHealthScore): number {
    if (score.state === 'HALF_OPEN') return 1.6;
    return 1;
  }

  /** Remove todos os contadores Redis do circuit breaker para um chip. */
  async resetChip(chipId: string): Promise<void> {
    const redis = getSharedRedis();
    const id = String(chipId || '').trim();
    if (!redis || !id) return;
    const keys = this.keys(id);
    await redis.del(...keys);
  }

  /** Remove todos os contadores Redis de uma lista de chips. */
  async resetMany(chipIds: string[]): Promise<void> {
    for (const id of chipIds) await this.resetChip(id);
  }
}

let defaultBreaker: ChipCircuitBreaker | null = null;

export function getChipCircuitBreaker(): ChipCircuitBreaker {
  if (!defaultBreaker) defaultBreaker = new ChipCircuitBreaker();
  return defaultBreaker;
}
