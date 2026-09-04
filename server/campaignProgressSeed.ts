import { digitsForCampaignJobId } from './campaignJobIdentity.js';
import {
  countCampaignJobsByStatus,
  listSettledCampaignJobs,
} from './campaignJobsResilience.js';
import {
  type CampaignCounterTriple,
  countersFromCampaignDoc,
  countersFromJobStatusCounts,
  mergeCampaignCounterTriple,
} from './campaignProgressGuard.js';
import { fetchCampaignDoc } from './campaignStore.js';
import { listCampaignSentLogPhones } from './repositories/campaignsRepository.js';

export type CampaignProgressSeed = CampaignCounterTriple & {
  settledJobIds: Set<string>;
  settledPhoneStages: Set<string>;
  sentPhoneKeys: Set<string>;
};

function addPhoneKeys(target: Set<string>, phone: string): void {
  const digits = digitsForCampaignJobId(phone);
  if (digits.length < 8) return;
  target.add(digits);
  const last11 = digits.slice(-11);
  if (last11.length >= 8) target.add(last11);
}

export function campaignPhoneSkipKeys(phone: string): string[] {
  const digits = digitsForCampaignJobId(phone);
  if (digits.length < 8) return [];
  const last11 = digits.slice(-11);
  return last11 !== digits && last11.length >= 8 ? [digits, last11] : [digits];
}

export async function loadCampaignProgressSeed(
  tenantId: string | undefined,
  campaignId: string
): Promise<CampaignProgressSeed> {
  const empty: CampaignProgressSeed = {
    successCount: 0,
    failedCount: 0,
    processedCount: 0,
    settledJobIds: new Set(),
    settledPhoneStages: new Set(),
    sentPhoneKeys: new Set(),
  };
  const cid = String(campaignId || '').trim();
  const uid = String(tenantId || '').trim();
  if (!cid) return empty;

  let counters: CampaignCounterTriple = { successCount: 0, failedCount: 0, processedCount: 0 };
  if (uid) {
    const doc = await fetchCampaignDoc(uid, cid).catch(() => null);
    counters = mergeCampaignCounterTriple(counters, countersFromCampaignDoc(doc));
  }

  const jobCounts = await countCampaignJobsByStatus(cid);
  counters = mergeCampaignCounterTriple(counters, countersFromJobStatusCounts(jobCounts));

  const settled = await listSettledCampaignJobs(cid);
  for (const job of settled) {
    if (job.idempotencyKey) empty.settledJobIds.add(job.idempotencyKey);
    const digits = digitsForCampaignJobId(job.toNumber);
    if (digits.length >= 8) {
      empty.settledPhoneStages.add(`${digits}@${job.stageIndex}`);
      const last11 = digits.slice(-11);
      if (last11.length >= 8) empty.settledPhoneStages.add(`${last11}@${job.stageIndex}`);
    }
    addPhoneKeys(empty.sentPhoneKeys, job.toNumber);
  }

  if (uid) {
    const logPhones = await listCampaignSentLogPhones(uid, cid).catch(() => []);
    for (const phone of logPhones) addPhoneKeys(empty.sentPhoneKeys, phone);
    if (logPhones.length > counters.successCount) {
      counters = mergeCampaignCounterTriple(counters, {
        successCount: logPhones.length,
        failedCount: counters.failedCount,
        processedCount: logPhones.length + counters.failedCount,
      });
    }
  }

  return {
    ...counters,
    settledJobIds: empty.settledJobIds,
    settledPhoneStages: empty.settledPhoneStages,
    sentPhoneKeys: empty.sentPhoneKeys,
  };
}

export function shouldSkipSettledCampaignEnqueue(
  seed: CampaignProgressSeed,
  jobId: string,
  phone: string,
  stageIndex: number,
  skipPhoneIfAlreadySent: boolean
): boolean {
  if (seed.settledJobIds.has(jobId)) return true;
  const keys = campaignPhoneSkipKeys(phone);
  for (const key of keys) {
    if (seed.settledPhoneStages.has(`${key}@${stageIndex}`)) return true;
    if (skipPhoneIfAlreadySent && seed.sentPhoneKeys.has(key)) return true;
  }
  return false;
}
