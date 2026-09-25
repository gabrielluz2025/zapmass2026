/**
 * Cota diária por chip — reserva atômica (evita estouro com worker paralelo).
 * O espelho PG (campaign_jobs) alimenta um piso quando RAM fica atrás.
 */

type QuotaConn = {
  dailyLimit?: number;
  messagesSentToday?: number;
  limitExceededApproved?: boolean;
  lastLimitResetDate?: string;
  growthRate?: number;
  growthType?: 'percent' | 'fixed';
  instanceName: string;
  friendlyName?: string;
  ownerUid?: string;
  limitAction?: 'ask' | 'redirect';
};

export type DailyQuotaDeps = {
  getConnection: (id: string) => QuotaConn | undefined;
  brazilTodayKey: () => string;
  onResetPersist: (id: string, conn: QuotaConn) => void;
  onConsumePersist: (id: string, conn: QuotaConn) => void;
};

const pgSentTodayFloor = new Map<string, number>();
const quotaTail = new Map<string, Promise<void>>();

export function setConnectionPgSentTodayFloor(connectionId: string, sentToday: number): void {
  const id = String(connectionId || '').trim();
  if (!id) return;
  const n = Math.max(0, Math.floor(Number(sentToday) || 0));
  if (n <= 0) return;
  pgSentTodayFloor.set(id, Math.max(pgSentTodayFloor.get(id) || 0, n));
}

export function getPgSentTodayFloor(connectionId: string): number {
  return pgSentTodayFloor.get(String(connectionId || '').trim()) || 0;
}

function runUnderConnectionQuotaLock<T>(connectionId: string, fn: () => T): Promise<T> {
  const id = String(connectionId || '').trim();
  const prev = quotaTail.get(id) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  quotaTail.set(
    id,
    prev.then(() => gate)
  );
  return prev.then(() => {
    try {
      return fn();
    } finally {
      release();
    }
  });
}

export function checkAndResetDailyLimitsWithDeps(conn: QuotaConn, deps: DailyQuotaDeps): void {
  const today = deps.brazilTodayKey();
  if (conn.lastLimitResetDate === today) return;

  const hadPriorDay = Boolean(conn.lastLimitResetDate);
  if (hadPriorDay && conn.dailyLimit && conn.growthRate && conn.growthRate > 0) {
    const oldLimit = conn.dailyLimit;
    if (conn.growthType === 'percent') {
      conn.dailyLimit = Math.round(conn.dailyLimit * (1 + conn.growthRate / 100));
    } else {
      conn.dailyLimit = conn.dailyLimit + conn.growthRate;
    }
    console.info(
      `[LimitReset] Limite diário do chip ${conn.instanceName} cresceu de ${oldLimit} para ${conn.dailyLimit}.`
    );
  }

  if (hadPriorDay) {
    conn.messagesSentToday = 0;
    conn.limitExceededApproved = false;
  }
  conn.lastLimitResetDate = today;
  deps.onResetPersist(conn.instanceName, conn);
}

export function getEffectiveMessagesSentToday(connectionId: string, deps: DailyQuotaDeps): number {
  const id = String(connectionId || '').trim();
  const conn = deps.getConnection(id);
  if (!conn) return getPgSentTodayFloor(id);
  checkAndResetDailyLimitsWithDeps(conn, deps);
  return Math.max(conn.messagesSentToday || 0, getPgSentTodayFloor(id));
}

export type ConsumeDailyQuotaResult = 'ok' | 'blocked' | 'exempt';

/** Reserva 1 vaga antes do envio real (serializado por chip). */
export async function consumeDailyCampaignQuota(
  connectionId: string,
  deps: DailyQuotaDeps
): Promise<ConsumeDailyQuotaResult> {
  const id = String(connectionId || '').trim();
  if (!id) return 'exempt';
  return runUnderConnectionQuotaLock(id, () => {
    const conn = deps.getConnection(id);
    if (!conn) return 'exempt';
    checkAndResetDailyLimitsWithDeps(conn, deps);
    if (conn.limitExceededApproved) return 'exempt';
    const limit = conn.dailyLimit || 0;
    if (limit <= 0) return 'exempt';
    const effective = Math.max(conn.messagesSentToday || 0, getPgSentTodayFloor(id));
    if (effective >= limit) return 'blocked';
    conn.messagesSentToday = effective + 1;
    deps.onConsumePersist(id, conn);
    return 'ok';
  });
}

/** Devolve vaga se o envio falhou após reserva. */
export async function releaseDailyCampaignQuota(connectionId: string, deps: DailyQuotaDeps): Promise<void> {
  const id = String(connectionId || '').trim();
  if (!id) return;
  await runUnderConnectionQuotaLock(id, () => {
    const conn = deps.getConnection(id);
    if (!conn) return;
    checkAndResetDailyLimitsWithDeps(conn, deps);
    const next = Math.max(0, (conn.messagesSentToday || 0) - 1);
    conn.messagesSentToday = next;
    deps.onConsumePersist(id, conn);
  });
}

/**
 * Retorna a cota diária efetiva para um canal considerando a cota da campanha
 * e o limite configurado na própria conexão. Se connDailyLimit > 0, age como teto máximo.
 */
export function resolveEffectiveChannelQuota(
  campaignLimit: number,
  connDailyLimit?: number | null
): number {
  const camp = Math.max(1, Math.floor(Number(campaignLimit) || 1));
  const conn = Math.max(0, Math.floor(Number(connDailyLimit) || 0));
  return conn > 0 ? Math.min(camp, conn) : camp;
}

