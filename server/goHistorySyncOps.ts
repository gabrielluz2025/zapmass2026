/** Telemetria e fila pós-campanha para HistorySync (Evolution Go / instance restart). */

const RESTART_EVENT_TTL_MS = 60 * 60 * 1000;
const POST_CAMPAIGN_SYNC_DELAY_MS = Math.max(
  60_000,
  Math.min(15 * 60_000, Number(process.env.GO_HISTORY_SYNC_POST_CAMPAIGN_DELAY_MS ?? 180_000))
);

type RestartEvent = { at: number; ownerUid: string; connectionId: string };

const restartEvents: RestartEvent[] = [];
const deferredPostCampaignSync = new Set<string>();
const postCampaignTimers = new Map<string, ReturnType<typeof setTimeout>>();

function pruneRestartEvents(now = Date.now()): void {
  const cutoff = now - RESTART_EVENT_TTL_MS;
  while (restartEvents.length > 0 && restartEvents[0]!.at < cutoff) {
    restartEvents.shift();
  }
}

export function recordGoHistorySyncRestart(ownerUid: string, connectionId: string): void {
  const ou = String(ownerUid || '').trim();
  const cid = String(connectionId || '').trim();
  if (!ou || !cid) return;
  restartEvents.push({ at: Date.now(), ownerUid: ou, connectionId: cid });
  pruneRestartEvents();
}

/** Sync full foi adiado durante disparo — enfileirar recuperação leve após campanha. */
export function markHistorySyncDeferredForOwner(ownerUid: string): void {
  const uid = String(ownerUid || '').trim();
  if (!uid || uid === 'anonymous') return;
  deferredPostCampaignSync.add(uid);
}

export type GoHistorySyncOpsSnapshot = {
  restartsLastHour: number;
  deferredPostCampaign: boolean;
  maxConcurrentPerOwner: number;
};

export function getGoHistorySyncOpsForOwner(
  ownerUid: string,
  maxConcurrentPerOwner: number
): GoHistorySyncOpsSnapshot {
  const uid = String(ownerUid || '').trim();
  pruneRestartEvents();
  let restartsLastHour = 0;
  for (const ev of restartEvents) {
    if (ev.ownerUid === uid) restartsLastHour++;
  }
  return {
    restartsLastHour,
    deferredPostCampaign: deferredPostCampaignSync.has(uid),
    maxConcurrentPerOwner,
  };
}

/**
 * Após a última campanha bloqueadora terminar, roda sync do celular com atraso
 * (Evolution Go — no máximo 1 restart simultâneo por tenant).
 */
export function schedulePostCampaignInboxSync(
  ownerUid: string,
  run: () => Promise<unknown>
): void {
  const uid = String(ownerUid || '').trim();
  if (!uid || uid === 'anonymous') return;
  if (!deferredPostCampaignSync.has(uid)) return;

  const prev = postCampaignTimers.get(uid);
  if (prev) clearTimeout(prev);

  const timer = setTimeout(() => {
    postCampaignTimers.delete(uid);
    if (!deferredPostCampaignSync.has(uid)) return;
    deferredPostCampaignSync.delete(uid);
    void run().catch(() => undefined);
  }, POST_CAMPAIGN_SYNC_DELAY_MS);
  postCampaignTimers.set(uid, timer);
}
