/**
 * Persistência de campanhas: Postgres (VPS) ou Firestore (legado).
 */
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import {
  addCampaignLog as pgAddLog,
  createCampaign as pgCreate,
  deleteAllCampaigns as pgDeleteAll,
  deleteCampaign as pgDelete,
  getCampaignDoc as pgGetDoc,
  listDueScheduledCampaigns,
  listCampaigns as pgList,
  mergeUpdateCampaign as pgMergeUpdate,
  releaseScheduledCampaignLock,
  tryClaimScheduledCampaignLock
} from './repositories/campaignsRepository.js';
import type { DueScheduledRow } from './repositories/campaignsRepository.js';

export function usePostgresCampaigns(): boolean {
  return vpsDataEnabled() && !!getZapmassPool();
}

export async function persistCampaignLog(
  ownerUid: string | undefined,
  campaignId: string | undefined,
  level: string,
  message: string,
  payload?: Record<string, unknown>
): Promise<void> {
  if (!ownerUid || !campaignId) return;
  const p = {
    to: String(payload?.to || ''),
    connectionId: String(payload?.connectionId || ''),
    error: String(payload?.error || ''),
    ...(payload || {})
  };
  if (usePostgresCampaigns()) {
    await pgAddLog(ownerUid, campaignId, level, message, p);
    return;
  }
  try {
    const admin = getFirebaseAdmin();
    if (!admin) return;
    const db = getFirestore(admin);
    await db
      .collection('users')
      .doc(ownerUid)
      .collection('campaigns')
      .doc(campaignId)
      .collection('logs')
      .add({
        level: level.toUpperCase(),
        message,
        ...p,
        createdAt: new Date().toISOString()
      });
  } catch (e) {
    console.warn('[CampaignLog] Firestore:', e);
  }
}

export async function persistCampaignProgress(
  ownerUid: string | undefined,
  campaignId: string | undefined,
  successCount: number,
  failCount: number,
  processedCount: number,
  status?: string
): Promise<void> {
  if (!ownerUid || !campaignId) return;
  const patch: Record<string, unknown> = {
    successCount,
    failedCount: failCount,
    processedCount
  };
  if (status) patch.status = status;
  if (usePostgresCampaigns()) {
    await pgMergeUpdate(ownerUid, campaignId, patch);
    return;
  }
  try {
    const admin = getFirebaseAdmin();
    if (!admin) return;
    const db = getFirestore(admin);
    await db.collection('users').doc(ownerUid).collection('campaigns').doc(campaignId).update(patch);
  } catch (e) {
    console.warn('[CampaignProgress] Firestore:', e);
  }
}

export async function updateCampaignFields(
  ownerUid: string,
  campaignId: string,
  patch: Record<string, unknown>
): Promise<void> {
  if (usePostgresCampaigns()) {
    await pgMergeUpdate(ownerUid, campaignId, patch);
    return;
  }
  const admin = getFirebaseAdmin();
  if (!admin) return;
  await getFirestore(admin)
    .collection('users')
    .doc(ownerUid)
    .collection('campaigns')
    .doc(campaignId)
    .update(patch);
}

export async function fetchCampaignDoc(
  ownerUid: string,
  campaignId: string
): Promise<Record<string, unknown> | null> {
  if (usePostgresCampaigns()) {
    return pgGetDoc(ownerUid, campaignId);
  }
  const admin = getFirebaseAdmin();
  if (!admin) return null;
  const snap = await getFirestore(admin).doc(`users/${ownerUid}/campaigns/${campaignId}`).get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : null;
}

export async function createCampaignRecord(
  ownerUid: string,
  payload: Record<string, unknown>
): Promise<string> {
  if (usePostgresCampaigns()) {
    const { id } = await pgCreate(ownerUid, payload);
    return id;
  }
  const admin = getFirebaseAdmin();
  if (!admin) throw new Error('Firebase Admin não configurado.');
  const ref = await getFirestore(admin)
    .collection('users')
    .doc(ownerUid)
    .collection('campaigns')
    .add(payload);
  return ref.id;
}

export async function deleteCampaignRecord(ownerUid: string, campaignId: string): Promise<void> {
  if (usePostgresCampaigns()) {
    await pgDelete(ownerUid, campaignId);
    return;
  }
  const admin = getFirebaseAdmin();
  if (!admin) return;
  const db = getFirestore(admin);
  const logs = await db
    .collection('users')
    .doc(ownerUid)
    .collection('campaigns')
    .doc(campaignId)
    .collection('logs')
    .get();
  const batch = db.batch();
  for (const d of logs.docs) batch.delete(d.ref);
  batch.delete(db.doc(`users/${ownerUid}/campaigns/${campaignId}`));
  await batch.commit();
}

export async function listTenantCampaigns(ownerUid: string) {
  if (usePostgresCampaigns()) return pgList(ownerUid);
  return null;
}

export async function fetchDueScheduledCampaigns(limit = 5): Promise<DueScheduledRow[]> {
  if (usePostgresCampaigns()) return listDueScheduledCampaigns(limit);
  return [];
}

export async function claimScheduledCampaign(
  ownerUid: string,
  campaignId: string,
  lockMs: number
): Promise<boolean> {
  if (usePostgresCampaigns()) return tryClaimScheduledCampaignLock(ownerUid, campaignId, lockMs);
  return false;
}

export { releaseScheduledCampaignLock };

export async function deleteAllTenantCampaigns(ownerUid: string): Promise<number> {
  if (usePostgresCampaigns()) return pgDeleteAll(ownerUid);
  return 0;
}
