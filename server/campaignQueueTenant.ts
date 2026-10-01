/**
 * Inspeção e remoção de jobs BullMQ com escopo de tenant (JWT VPS).
 */

import type { Job, Queue } from 'bullmq';
import { tenantScopeUidsMatch } from './auth/tenantUidScopeServer.js';
import {
  maskQueuePhone,
  queueJobStepIndex,
  type CampaignQueueRemoveConfirmScope,
} from '../shared/campaignQueueTenantHelpers.js';
import {
  emptyStateCounts,
  type CampaignQueueStateCounts,
} from './campaignQueueAdmin.js';
import {
  forEachCampaignQueueJob,
  type CampaignQueueScanState,
} from './campaignQueueScan.js';

export type QueueJobOwnerData = {
  campaignId?: string;
  ownerUid?: string;
  connectionId?: string;
  to?: string;
  replyFlowOpen?: { ownerUid?: string };
  stageIndex?: number;
  multiStepContact?: { stepIndex?: number };
  nurtureStepIndex?: number;
  replyFlowResponse?: boolean;
  nurtureFollowUp?: boolean;
};

export function resolveQueueJobOwnerUid(data: QueueJobOwnerData): string {
  return String(data.ownerUid || data.replyFlowOpen?.ownerUid || '').trim();
}

export function queueJobBelongsToTenant(data: QueueJobOwnerData, tenantId: string): boolean {
  const tid = String(tenantId || '').trim();
  if (!tid) return false;
  const owner = resolveQueueJobOwnerUid(data);
  if (!owner) return true;
  return tenantScopeUidsMatch(tid, owner);
}

export type CampaignQueueInspectFilters = {
  connectionId?: string;
  campaignId?: string;
  stepIndex?: number;
};

export type CampaignQueueInspectGroup = {
  connectionId: string;
  campaignId: string;
  stepIndex: number;
  jobs: number;
  byState: CampaignQueueStateCounts;
  samplePhones: string[];
};

export type CampaignQueueInspectResult = {
  groups: CampaignQueueInspectGroup[];
  totals: { jobs: number; byState: CampaignQueueStateCounts };
  scannedJobs: number;
  truncated: boolean;
};

function groupKey(connectionId: string, campaignId: string, stepIndex: number): string {
  return `${connectionId}\0${campaignId}\0${stepIndex}`;
}

function jobMatchesFilters(
  data: QueueJobOwnerData,
  filters: CampaignQueueInspectFilters
): boolean {
  const conn = String(filters.connectionId || '').trim();
  const cid = String(filters.campaignId || '').trim();
  if (conn && String(data.connectionId || '').trim() !== conn) return false;
  if (cid && String(data.campaignId || '').trim() !== cid) return false;
  if (filters.stepIndex != null && queueJobStepIndex(data) !== filters.stepIndex) return false;
  return true;
}

/** Agrupa jobs por chip + campanha + etapa (somente tenant). */
export async function inspectTenantCampaignQueues(
  queues: Queue[],
  tenantId: string,
  opts?: {
    filters?: CampaignQueueInspectFilters;
    groupLimit?: number;
    samplePhonesPerGroup?: number;
  }
): Promise<CampaignQueueInspectResult> {
  const filters = opts?.filters || {};
  const groupLimit = Math.max(1, Math.min(200, opts?.groupLimit ?? 80));
  const sampleMax = Math.max(0, Math.min(8, opts?.samplePhonesPerGroup ?? 3));

  const byGroup = new Map<
    string,
    { connectionId: string; campaignId: string; stepIndex: number; byState: CampaignQueueStateCounts; phones: string[] }
  >();
  const totals = emptyStateCounts();
  let scannedJobs = 0;
  let matchedJobs = 0;

  for (const queue of queues) {
    await forEachCampaignQueueJob(queue, async (job, state) => {
      scannedJobs += 1;
      const data = (job.data || {}) as QueueJobOwnerData;
      if (!queueJobBelongsToTenant(data, tenantId)) return;
      if (!jobMatchesFilters(data, filters)) return;
      const campaignId = String(data.campaignId || '').trim();
      if (!campaignId) return;
      if (data.replyFlowResponse || data.nurtureFollowUp) return;

      matchedJobs += 1;
      totals[state] += 1;

      const connectionId = String(data.connectionId || '').trim() || '—';
      const stepIndex = queueJobStepIndex(data);
      const key = groupKey(connectionId, campaignId, stepIndex);
      let row = byGroup.get(key);
      if (!row) {
        row = {
          connectionId,
          campaignId,
          stepIndex,
          byState: emptyStateCounts(),
          phones: [],
        };
        byGroup.set(key, row);
      }
      row.byState[state] += 1;
      if (sampleMax > 0 && data.to && row.phones.length < sampleMax) {
        const masked = maskQueuePhone(data.to);
        if (!row.phones.includes(masked)) row.phones.push(masked);
      }
    });
  }

  const groups: CampaignQueueInspectGroup[] = [...byGroup.values()]
    .map((row) => ({
      connectionId: row.connectionId,
      campaignId: row.campaignId,
      stepIndex: row.stepIndex,
      jobs:
        row.byState.active +
        row.byState.waiting +
        row.byState.delayed +
        row.byState.paused,
      byState: row.byState,
      samplePhones: row.phones,
    }))
    .sort((a, b) => b.jobs - a.jobs);

  const truncated = groups.length > groupLimit;
  return {
    groups: groups.slice(0, groupLimit),
    totals: { jobs: matchedJobs, byState: totals },
    scannedJobs,
    truncated,
  };
}

export type CampaignQueueRemoveFilters = CampaignQueueInspectFilters & {
  jobIds?: string[];
  states?: CampaignQueueScanState[];
};

export type CampaignQueueRemoveResult = {
  dryRun: boolean;
  matched: number;
  removed: number;
  wouldRemove: number;
  skippedActive: number;
  failedRemove: number;
  promotedDelayed: number;
  byState: CampaignQueueStateCounts;
};

const DEFAULT_REMOVABLE: CampaignQueueScanState[] = ['waiting', 'delayed', 'paused'];

function stateAllowed(state: CampaignQueueScanState, allowed?: CampaignQueueScanState[]): boolean {
  const list = allowed && allowed.length > 0 ? allowed : DEFAULT_REMOVABLE;
  return list.includes(state);
}

export async function removeTenantCampaignQueueJobs(
  queues: Queue[],
  tenantId: string,
  filters: CampaignQueueRemoveFilters,
  opts: { dryRun: boolean }
): Promise<CampaignQueueRemoveResult> {
  const jobIdSet = new Set((filters.jobIds || []).map((id) => String(id).trim()).filter(Boolean));
  const byState = emptyStateCounts();
  let matched = 0;
  let removed = 0;
  let wouldRemove = 0;
  let skippedActive = 0;
  let failedRemove = 0;
  const toRemove: Job[] = [];

  for (const queue of queues) {
    await forEachCampaignQueueJob(queue, async (job, state) => {
      const data = (job.data || {}) as QueueJobOwnerData;
      if (!queueJobBelongsToTenant(data, tenantId)) return;
      if (!jobMatchesFilters(data, filters)) return;
      if (jobIdSet.size > 0 && !jobIdSet.has(String(job.id))) return;
      if (data.replyFlowResponse || data.nurtureFollowUp) return;

      matched += 1;
      byState[state] += 1;

      if (state === 'active') {
        skippedActive += 1;
        return;
      }
      if (!stateAllowed(state, filters.states)) {
        skippedActive += 1;
        return;
      }

      if (opts.dryRun) {
        wouldRemove += 1;
        return;
      }
      toRemove.push(job);
    });
  }

  for (const job of toRemove) {
    try {
      await job.remove();
      removed += 1;
    } catch {
      failedRemove += 1;
    }
  }

  return {
    dryRun: opts.dryRun,
    matched,
    removed,
    wouldRemove,
    skippedActive,
    failedRemove,
    promotedDelayed: 0,
    byState,
  };
}

/** Promove jobs delayed (delay → 0) sem remover — útil para destravar fila. */
export async function promoteTenantDelayedQueueJobs(
  queues: Queue[],
  tenantId: string,
  filters: CampaignQueueInspectFilters,
  opts: { dryRun: boolean }
): Promise<CampaignQueueRemoveResult> {
  const byState = emptyStateCounts();
  let matched = 0;
  let promotedDelayed = 0;
  let wouldRemove = 0;

  for (const queue of queues) {
    await forEachCampaignQueueJob(queue, async (job, state) => {
      if (state !== 'delayed') return;
      const data = (job.data || {}) as QueueJobOwnerData;
      if (!queueJobBelongsToTenant(data, tenantId)) return;
      if (!jobMatchesFilters(data, filters)) return;
      if (data.replyFlowResponse || data.nurtureFollowUp) return;

      matched += 1;
      byState.delayed += 1;
      if (opts.dryRun) {
        wouldRemove += 1;
        return;
      }
      try {
        await job.changeDelay(0);
        promotedDelayed += 1;
      } catch {
        /* job removido ou ativo */
      }
    });
  }

  return {
    dryRun: opts.dryRun,
    matched,
    removed: 0,
    wouldRemove,
    skippedActive: 0,
    failedRemove: 0,
    promotedDelayed,
    byState,
  };
}

export function inferRemoveConfirmScope(
  filters: CampaignQueueRemoveFilters
): { scope: CampaignQueueRemoveConfirmScope; scopeId?: string } {
  if (filters.jobIds && filters.jobIds.length > 0) return { scope: 'jobs' };
  if (filters.campaignId && filters.stepIndex != null) {
    return { scope: 'step', scopeId: `${filters.campaignId}:${filters.stepIndex}` };
  }
  if (filters.campaignId) return { scope: 'campaign', scopeId: filters.campaignId };
  if (filters.connectionId) return { scope: 'channel', scopeId: filters.connectionId };
  return { scope: 'all' };
}
