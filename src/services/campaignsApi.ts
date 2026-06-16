import type { Campaign } from '../types';
import { apiUrl } from '../utils/apiBase';
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

export type CampaignReportSnapshotDto = {
  builtAt: string;
  logCount: number;
  rows: Array<{
    phone: string;
    contactName: string;
    status: string;
    sentTime: string;
    sentTimestampMs: number;
    replyText?: string;
    replyTime?: string;
    replyTimestampMs?: number;
    connectionId?: string;
    errorMessage?: string;
  }>;
  replyPhones: Record<string, { replyText?: string; replyTimestampMs: number }>;
  stageFunnels: Array<{
    stageNumber: number;
    label: string;
    sent: number;
    delivered: number;
    read: number;
    replied: number;
    deliveryPct: number;
    readPct: number;
    replyPct: number;
  }>;
  totals: { sent: number; delivered: number; read: number; replied: number };
};

export async function fetchCampaignReport(
  campaignId: string
): Promise<CampaignReportSnapshotDto | null> {
  const path = `/api/campaigns/${encodeURIComponent(campaignId)}/report`;
  const j = await apiFetchJson<{ ok?: boolean; snapshot?: CampaignReportSnapshotDto }>(path);
  return j.snapshot && typeof j.snapshot === 'object' ? j.snapshot : null;
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

// ─── Motor multi-etapas ──────────────────────────────────────────────────────

export type ContactStateStepSummaryDto = {
  step_index: number;
  status: string;
  count: number;
};

export async function fetchCampaignContactStates(
  campaignId: string
): Promise<ContactStateStepSummaryDto[]> {
  const path = `/api/campaigns/${encodeURIComponent(campaignId)}/contact-states`;
  const j = await apiFetchJson<{ summary?: ContactStateStepSummaryDto[] }>(path);
  return Array.isArray(j.summary) ? j.summary : [];
}

export async function retryFailedContacts(
  campaignId: string,
  stepIndex: number
): Promise<number> {
  const path = `/api/campaigns/${encodeURIComponent(campaignId)}/retry-failed`;
  const j = await apiFetchJson<{ reset?: number }>(path, {
    method: 'POST',
    body: JSON.stringify({ stepIndex })
  });
  return Number(j.reset) || 0;
}

// ─── Saúde do motor de disparo ───────────────────────────────────────────────

export type DispatchHealth = {
  ok: boolean;
  ready: boolean;
  redis: {
    ok: boolean;
    configured?: boolean;
    pingMs?: number;
    error?: string | null;
    host?: string;
    misconfigHint?: string | null;
  };
  fixCommand?: string;
  checkedAt?: string;
};

/** Ping unificado Redis + metadados (endpoint público, sem auth). */
export async function fetchDispatchHealth(): Promise<DispatchHealth> {
  try {
    const r = await fetch(apiUrl('/api/health/dispatch'), {
      signal: AbortSignal.timeout(8000),
    });
    const j = (await r.json().catch(() => ({}))) as Partial<DispatchHealth>;
    return {
      ok: Boolean(j.ok),
      ready: Boolean(j.ready),
      redis: j.redis ?? { ok: false, error: 'Resposta inválida do servidor' },
      fixCommand: j.fixCommand,
      checkedAt: j.checkedAt,
    };
  } catch {
    return {
      ok: false,
      ready: false,
      redis: { ok: false, error: 'Servidor inacessível ou timeout' },
    };
  }
}

// ─── Pré-voo e diagnóstico de disparo ────────────────────────────────────────

export type PreflightConnectionResult = {
  connectionId: string;
  status: string;
  isReady: boolean;
  error: string | null;
};

export type PreflightResult = {
  ok: boolean;
  allReady: boolean;
  readyCount: number;
  totalChecked: number;
  results: PreflightConnectionResult[];
};

/** Verifica se os chips estão prontos para disparo (sem enviar mensagem). */
export async function apiPreflightCheck(connectionIds: string[]): Promise<PreflightResult> {
  const j = await apiFetchJson<PreflightResult>('/api/campaigns/preflight', {
    method: 'POST',
    body: JSON.stringify({ connectionIds })
  });
  return j;
}

export type TestSendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

/** Envia uma mensagem de teste para validar o chip antes do disparo em massa. */
export async function apiTestSend(
  connectionId: string,
  toNumber: string,
  message: string
): Promise<TestSendResult> {
  return apiFetchJson<TestSendResult>('/api/campaigns/test-send', {
    method: 'POST',
    body: JSON.stringify({ connectionId, toNumber, message })
  });
}

export type FailedJob = {
  jobId: string;
  campaignId: string;
  connectionId: string;
  to: string;
  failedReason: string;
  attemptsMade: number;
  failedAt?: string;
};

export type FailedJobsResult = {
  ok: boolean;
  jobs: FailedJob[];
};

/** Retorna os jobs falhos da fila BullMQ com o motivo real do erro. */
export async function apiGetFailedJobs(): Promise<FailedJobsResult> {
  return apiFetchJson<FailedJobsResult>('/api/campaigns/failed-jobs');
}
