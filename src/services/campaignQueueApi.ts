import { apiFetchJson } from '../utils/apiFetchAuth';

export type QueueStateCounts = {
  active: number;
  waiting: number;
  delayed: number;
  paused: number;
};

export type QueueInspectGroup = {
  connectionId: string;
  campaignId: string;
  stepIndex: number;
  jobs: number;
  byState: QueueStateCounts;
  samplePhones: string[];
};

export type QueueChannelSummary = {
  connectionId: string;
  knownToTenant: boolean;
  jobs: number;
  byState: QueueStateCounts;
};

export type QueueRuntimeCampaign = {
  campaignId: string;
  isRunning: boolean;
  pendingJobs: number;
  queueJobs: number;
  paused: boolean;
};

export type QueueInspectResult = {
  ok: boolean;
  channelQueues: number;
  groups: QueueInspectGroup[];
  totals: { jobs: number; byState: QueueStateCounts };
  channelSummaries?: QueueChannelSummary[];
  deadChannelJobs?: number;
  runtimeCampaigns?: QueueRuntimeCampaign[];
  scannedJobs: number;
  truncated: boolean;
};

export type QueueRemoveResult = {
  ok: boolean;
  paused?: boolean;
  result: {
    dryRun: boolean;
    matched: number;
    removed: number;
    wouldRemove: number;
    skippedActive: number;
    failedRemove: number;
    promotedDelayed?: number;
    byState: QueueStateCounts;
  };
  expectedScope?: string;
  expectedScopeId?: string;
  error?: string;
};

export async function apiInspectDispatchQueue(params?: {
  connectionId?: string;
  campaignId?: string;
  stepIndex?: number;
  limit?: number;
}): Promise<QueueInspectResult> {
  const q = new URLSearchParams();
  if (params?.connectionId) q.set('connectionId', params.connectionId);
  if (params?.campaignId) q.set('campaignId', params.campaignId);
  if (params?.stepIndex != null) q.set('stepIndex', String(params.stepIndex));
  if (params?.limit != null) q.set('limit', String(params.limit));
  const path = `/api/campaigns/queue/inspect${q.toString() ? `?${q}` : ''}`;
  return apiFetchJson<QueueInspectResult>(path);
}

export async function apiRemoveDispatchQueue(body: {
  connectionId?: string;
  campaignId?: string;
  stepIndex?: number;
  jobIds?: string[];
  dryRun?: boolean;
  confirm?: string;
  pauseFirst?: boolean;
}): Promise<QueueRemoveResult> {
  return apiFetchJson<QueueRemoveResult>('/api/campaigns/queue/remove', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true, pauseFirst: true, ...body }),
  });
}

export async function apiPromoteDelayedQueue(body: {
  connectionId?: string;
  campaignId?: string;
  stepIndex?: number;
  dryRun?: boolean;
  confirm?: string;
}): Promise<QueueRemoveResult> {
  return apiFetchJson<QueueRemoveResult>('/api/campaigns/queue/clear-delayed', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true, ...body }),
  });
}

export async function apiPurgeDeadChannelQueue(body: {
  dryRun?: boolean;
  confirm?: string;
}): Promise<QueueRemoveResult> {
  return apiFetchJson<QueueRemoveResult>('/api/campaigns/queue/purge-dead-channels', {
    method: 'POST',
    body: JSON.stringify({ dryRun: true, ...body }),
  });
}

export async function apiSetCampaignQueuePriority(
  campaignId: string,
  boosted: boolean
): Promise<{ ok: boolean; updated: number; error?: string }> {
  return apiFetchJson('/api/campaigns/queue/priority', {
    method: 'POST',
    body: JSON.stringify({
      campaignId,
      boosted,
      priority: boosted ? 'high' : 'normal',
    }),
  });
}
