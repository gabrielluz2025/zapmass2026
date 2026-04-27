import type { DocumentReference } from 'firebase-admin/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import * as waService from './whatsappService.js';
import { readUserSubscriptionForLimits, isUidTreatedAsServerAdmin } from './connectionLimits.js';
import { subscriptionEnforceFromEnv, userHasFullAppAccess } from './subscriptionAccess.js';
import { filterByConnectionScope, ownsConnectionForUid } from '../src/utils/connectionScope.js';
import { ConnectionStatus } from './types.js';

const RETRY_DELAY_MS = 5 * 60 * 1000;

async function canUserDispatch(uid: string): Promise<boolean> {
  if (!subscriptionEnforceFromEnv()) return true;
  if (await isUidTreatedAsServerAdmin(uid)) return true;
  const sub = await readUserSubscriptionForLimits(uid);
  return userHasFullAppAccess(sub, Date.now());
}

function parsePath(path: string): { ownerUid: string; campaignId: string } | null {
  const m = path.match(/^users\/([^/]+)\/campaigns\/([^/]+)$/);
  if (!m) return null;
  return { ownerUid: m[1], campaignId: m[2] };
}

/**
 * Verifica fila global de disparo e dispara campanhas `SCHEDULED` cujo `nextRunAt` já passou.
 */
export function startScheduledCampaignRunner(): void {
  const tick = () => {
    void runDueScheduledCampaigns();
  };
  setInterval(tick, 60_000);
  tick();
}

async function runDueScheduledCampaigns(): Promise<void> {
  const admin = getFirebaseAdmin();
  if (!admin) return;
  if (!waService.isMassCampaignEngineIdle()) return;

  const db = getFirestore(admin);
  const nowIso = new Date().toISOString();
  let snap;
  try {
    snap = await db
      .collectionGroup('campaigns')
      .where('status', '==', 'SCHEDULED')
      .where('nextRunAt', '<=', nowIso)
      .limit(5)
      .get();
  } catch (e) {
    console.warn(
      '[ScheduledCampaign] query Firestore (crie índice composto status+nextRunAt em campaigns):',
      (e as Error)?.message || e
    );
    return;
  }

  if (snap.empty) return;

  const sorted = snap.docs
    .map((d) => ({ ref: d.ref, data: d.data() as Record<string, unknown>, next: String(d.data()?.nextRunAt || '') }))
    .filter((x) => x.next)
    .sort((a, b) => a.next.localeCompare(b.next));

  for (const row of sorted) {
    if (!waService.isMassCampaignEngineIdle()) return;
    await processOne(row.ref, row.data);
  }
}

async function processOne(ref: DocumentReference, data: Record<string, unknown>): Promise<void> {
  const path = parsePath(ref.path);
  const ownerUid =
    path?.ownerUid || (typeof data.ownerUid === 'string' ? data.ownerUid : '');
  if (!ownerUid) return;

  if (!(await canUserDispatch(ownerUid))) {
    try {
      await ref.update({
        nextRunAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
      });
    } catch {
      /* ignore */
    }
    return;
  }

  const snap = data.scheduleStartSnapshot as
    | {
        numbers?: string[];
        message?: string;
        messageStages?: string[];
        connectionIds?: string[];
        delaySeconds?: number;
        recipients?: Array<{ phone: string; vars: Record<string, string> }>;
        replyFlow?: { enabled?: boolean; steps?: unknown[] };
      }
    | undefined;

  const connectionIds: string[] =
    Array.isArray(snap?.connectionIds) && snap!.connectionIds.length
      ? (snap!.connectionIds as string[]).map((x) => String(x || '')).filter(Boolean)
      : Array.isArray(data.selectedConnectionIds)
        ? (data.selectedConnectionIds as string[]).map((x) => String(x || '')).filter(Boolean)
        : [];

  if (!connectionIds.length) return;
  if (!connectionIds.every((id) => ownsConnectionForUid(ownerUid, id))) return;

  const scoped = filterByConnectionScope(ownerUid, waService.getConnections());
  const connectedIds = new Set(
    scoped.filter((c) => c.status === ConnectionStatus.CONNECTED).map((c) => c.id)
  );
  if (!connectionIds.some((id) => connectedIds.has(id))) {
    try {
      await ref.update({
        nextRunAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });
    } catch {
      /* ignore */
    }
    return;
  }

  const numbersRaw = Array.isArray(snap?.numbers) ? snap!.numbers : [];
  const numbers = Array.from(
    new Set(
      numbersRaw
        .map((n) => String(n || '').replace(/\D/g, ''))
        .filter((n) => n.length >= 10)
    )
  );
  if (numbers.length === 0) return;

  const stagesFromSnap = Array.isArray(snap?.messageStages)
    ? (snap!.messageStages as string[]).map((s) => String(s || '').trim()).filter((s) => s.length > 0)
    : [];
  const first = typeof snap?.message === 'string' ? snap.message.trim() : '';
  const stages =
    stagesFromSnap.length > 0 ? stagesFromSnap : first ? [first] : [];
  if (stages.length === 0) return;

  const cid = path?.campaignId || ref.id;
  const delaySeconds = Number(snap?.delaySeconds ?? data.delaySeconds);
  if (Number.isFinite(delaySeconds) && delaySeconds > 0) {
    waService.applySettings({ minDelay: delaySeconds, maxDelay: delaySeconds });
  }

  try {
    await ref.update({
      status: 'RUNNING',
      processedCount: 0,
      successCount: 0,
      failedCount: 0
    });
  } catch (e) {
    console.warn('[ScheduledCampaign] não marcou RUNNING:', (e as Error)?.message || e);
    return;
  }

  try {
    await waService.startCampaign(
      numbers,
      stages,
      connectionIds,
      cid,
      snap?.recipients,
      snap?.replyFlow,
      ownerUid
    );
  } catch (e) {
    console.error('[ScheduledCampaign] falha ao iniciar:', (e as Error)?.message || e);
    try {
      await ref.update({
        status: 'SCHEDULED',
        nextRunAt: new Date(Date.now() + RETRY_DELAY_MS).toISOString()
      });
    } catch {
      /* ignore */
    }
  }
}
