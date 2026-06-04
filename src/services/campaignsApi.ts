import type { Campaign } from '../types';
import { apiFetchJson } from '../utils/apiFetchAuth';

export async function fetchCampaigns(): Promise<Campaign[]> {
  const j = await apiFetchJson<{ campaigns?: Campaign[] }>('/api/campaigns');
  return Array.isArray(j.campaigns) ? j.campaigns : [];
}

export async function apiCreateCampaign(payload: Record<string, unknown>): Promise<string> {
  const j = await apiFetchJson<{ id?: string }>('/api/campaigns', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return String(j.id || '');
}

export async function apiUpdateCampaign(id: string, patch: Record<string, unknown>): Promise<void> {
  await apiFetchJson(`/api/campaigns/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
}

export async function apiDeleteCampaign(id: string): Promise<void> {
  await apiFetchJson(`/api/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function apiBulkDeleteCampaigns(
  ids: string[]
): Promise<{ deleted: string[]; missing: string[] }> {
  const j = await apiFetchJson<{ deleted?: string[]; missing?: string[] }>(
    '/api/campaigns/bulk-delete',
    { method: 'POST', body: JSON.stringify({ ids }) }
  );
  return {
    deleted: Array.isArray(j.deleted) ? j.deleted : [],
    missing: Array.isArray(j.missing) ? j.missing : []
  };
}

export async function apiDeleteAllCampaigns(): Promise<number> {
  const j = await apiFetchJson<{ campaigns?: number }>('/api/tenant/campaigns-data', {
    method: 'DELETE'
  });
  return Number(j.campaigns) || 0;
}

export type CampaignLogDto = {
  id: string;
  level: string;
  message: string;
  to?: string;
  phoneDigits?: string;
  replyPreview?: string;
  replyFlowStep?: number;
  currentStep?: number;
  campaignId?: string;
  connectionId?: string;
  error?: string;
  createdAt: string;
};

export type CampaignInboundReplyDto = {
  replyText: string;
  replyTimestampMs: number;
};

export async function fetchCampaignInboundReplies(
  campaignId: string
): Promise<Record<string, CampaignInboundReplyDto>> {
  const path = `/api/campaigns/${encodeURIComponent(campaignId)}/inbound-replies`;
  const j = await apiFetchJson<{ replies?: Record<string, CampaignInboundReplyDto> }>(path);
  return j.replies && typeof j.replies === 'object' ? j.replies : {};
}

export async function fetchCampaignLogs(
  campaignId: string,
  opts?: { limit?: number; offset?: number }
): Promise<{ logs: CampaignLogDto[]; hasMore: boolean }> {
  const q = new URLSearchParams();
  if (opts?.limit) q.set('limit', String(opts.limit));
  if (opts?.offset) q.set('offset', String(opts.offset));
  const path = `/api/campaigns/${encodeURIComponent(campaignId)}/logs${q.toString() ? `?${q}` : ''}`;
  const j = await apiFetchJson<{ logs?: CampaignLogDto[]; hasMore?: boolean }>(path);
  return {
    logs: Array.isArray(j.logs) ? j.logs : [],
    hasMore: !!j.hasMore
  };
}
