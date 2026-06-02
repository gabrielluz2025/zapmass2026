import { computeNextRunIso } from '../src/utils/campaignSchedule.js';
import { fetchCampaignDoc, updateCampaignFields, usePostgresCampaigns } from './campaignStore.js';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';

/**
 * Quando uma campanha agendada termina, o cliente costuma marcar COMPLETED.
 * Se for recorrente, reagendamos aqui para o utilizador offline / socket ausente.
 */
export async function onMassCampaignCompleteForSchedule(
  campaignId: string | undefined,
  ownerUid: string | undefined
): Promise<void> {
  if (!campaignId || !ownerUid) return;
  let data: Record<string, unknown> | null = null;
  if (usePostgresCampaigns()) {
    data = await fetchCampaignDoc(ownerUid, campaignId);
  } else {
    const admin = getFirebaseAdmin();
    if (!admin) return;
    const snap = await getFirestore(admin).doc(`users/${ownerUid}/campaigns/${campaignId}`).get();
    if (!snap.exists) return;
    data = snap.data() as Record<string, unknown>;
  }
  if (!data) return;
  if (data.scheduleRepeatWeekly !== true) return;

  const weekly = data.weeklySchedule as { slots?: Array<{ dayOfWeek: number; time: string }> } | undefined;
  const slots = Array.isArray(weekly?.slots) ? weekly!.slots : [];
  const tz = typeof data.scheduleTimeZone === 'string' ? data.scheduleTimeZone : '';
  if (!slots.length || !tz) return;

  const next = computeNextRunIso(slots, tz, Date.now() + 45_000);
  if (!next) return;

  try {
    await updateCampaignFields(ownerUid, campaignId, {
      status: 'SCHEDULED',
      nextRunAt: next,
      lastRunAt: new Date().toISOString(),
      processedCount: 0,
      successCount: 0,
      failedCount: 0
    });
  } catch (e) {
    console.warn('[campaignScheduleFollowup] falha ao reagendar:', (e as Error)?.message || e);
  }
}
