import type { DocumentReference } from 'firebase-admin/firestore';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import * as waService from './whatsappService.js';
import { emitScheduledCampaignUserNotice } from './whatsappService.js';
import { readUserSubscriptionForLimits, isUidTreatedAsServerAdmin } from './connectionLimits.js';
import { subscriptionEnforceFromEnv, userHasFullAppAccess } from './subscriptionAccess.js';
import { filterByConnectionScope, ownsConnectionForUid } from '../src/utils/connectionScope.js';
import { ConnectionStatus } from './types.js';

const RETRY_DELAY_MS = 5 * 60 * 1000;
/** Evita duas réplicas da API iniciarem o mesmo SCHEDULE em paralelo (lock em Firestore). */
const CAMPAIGN_LOCK_MS = 3 * 60 * 1000;
const SCHEDULE_LAUNCH_LOCK = '_scheduledLaunchLockUntil';

function readLockExpiryMs(lock: unknown): number | null {
  if (!lock) return null;
  if (lock instanceof Timestamp) return lock.toMillis();
  if (typeof lock === 'object' && lock !== null && 'toMillis' in lock) {
    const tm = (lock as { toMillis: () => number }).toMillis;
    if (typeof tm === 'function') return tm.call(lock);
  }
  return null;
}

async function releaseScheduledCampaignLaunchLock(ref: DocumentReference): Promise<void> {
  try {
    await ref.update({
      [SCHEDULE_LAUNCH_LOCK]: FieldValue.delete()
    } as Record<string, unknown>);
  } catch {
    /* ignore */
  }
}

/**
 * Tentativa única distribuída: só um processo deve passar antes de ler chips / iniciar envio.
 */
async function tryClaimScheduledCampaign(ref: DocumentReference): Promise<boolean> {
  const admin = getFirebaseAdmin();
  if (!admin) return false;
  const db = getFirestore(admin);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const d = snap.data() as Record<string, unknown>;
      if (String(d.status || '') !== 'SCHEDULED') return false;
      const next = String(d.nextRunAt || '');
      if (!next || next > nowIso) return false;
      const expiry = readLockExpiryMs(d[SCHEDULE_LAUNCH_LOCK]);
      if (expiry !== null && expiry > nowMs) return false;

      tx.update(ref, {
        [SCHEDULE_LAUNCH_LOCK]: Timestamp.fromMillis(nowMs + CAMPAIGN_LOCK_MS)
      });
      return true;
    });
  } catch (e) {
    console.warn('[ScheduledCampaign] claim transaction falhou:', (e as Error)?.message || e);
    return false;
  }
}

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
  setInterval(tick, 30_000);
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
  const claimed = await tryClaimScheduledCampaign(ref);
  if (!claimed) return;

  let transitionedToRunning = false;
  try {
    const path = parsePath(ref.path);
    const ownerUid =
      path?.ownerUid || (typeof data.ownerUid === 'string' ? data.ownerUid : '');
    if (!ownerUid) return;

    const campaignIdEarly = path?.campaignId || ref.id;
    const campaignName =
      typeof data.name === 'string' && data.name.trim().length > 0 ? data.name.trim() : 'Campanha agendada';

    if (!(await canUserDispatch(ownerUid))) {
      try {
        await ref.update({
          nextRunAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
        });
      } catch {
        /* ignore */
      }
      emitScheduledCampaignUserNotice(ownerUid, {
        kind: 'subscription',
        campaignId: campaignIdEarly,
        message: `[Agendado] "${campaignName}" adiado: assinatura ou acesso Pro inativo. Nova tentativa em ~6 h. Conecte-se e verifique a assinatura.`
      });
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
          channelWeights?: Record<string, number>;
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
      emitScheduledCampaignUserNotice(ownerUid, {
        kind: 'no_chip',
        campaignId: campaignIdEarly,
        message: `[Agendado] "${campaignName}": nenhum dos chips selecionados está conectado. Nova tentativa em ~10 min. Abra o WhatsApp no servidor ou reconecte o chip.`
      });
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

    const scheduledWeights =
      snap?.channelWeights && typeof snap.channelWeights === 'object' && snap.channelWeights !== null
        ? (snap.channelWeights as Record<string, number>)
        : undefined;

    try {
      const started = await waService.startCampaign(
        numbers,
        stages,
        connectionIds,
        cid,
        snap?.recipients,
        snap?.replyFlow,
        ownerUid,
        scheduledWeights
      );
      if (!started) {
        console.warn('[ScheduledCampaign] startCampaign não iniciou (canais indisponíveis ou fila vazia). Reagendando.');
        try {
          await ref.update({
            status: 'SCHEDULED',
            nextRunAt: new Date(Date.now() + RETRY_DELAY_MS).toISOString()
          });
        } catch {
          /* ignore */
        }
        emitScheduledCampaignUserNotice(ownerUid, {
          kind: 'retry',
          campaignId: cid,
          message: `[Agendado] "${campaignName}": o WhatsApp não iniciou o envio (chip indisponível ou instável). Nova tentativa em ~5 min.`
        });
        return;
      }
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
      emitScheduledCampaignUserNotice(ownerUid, {
        kind: 'retry',
        campaignId: cid,
        message: `[Agendado] "${campaignName}": erro ao iniciar (${(e as Error)?.message || 'desconhecido'}). Reagendado para ~5 min.`
      });
      return;
    }

    try {
      await ref.update({
        status: 'RUNNING',
        processedCount: 0,
        successCount: 0,
        failedCount: 0,
        [SCHEDULE_LAUNCH_LOCK]: FieldValue.delete()
      } as Record<string, unknown>);
      transitionedToRunning = true;
    } catch (e) {
      console.warn('[ScheduledCampaign] não marcou RUNNING após fila iniciada:', (e as Error)?.message || e);
    }
  } finally {
    if (!transitionedToRunning) await releaseScheduledCampaignLaunchLock(ref);
  }
}
