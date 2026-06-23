import type { Campaign } from '../types';
import { apiUrl } from '../utils/apiBase';
import { apiFetchJson } from '../utils/apiFetchAuth';

const CAMPAIGNS_API_TIMEOUT_MS = 90_000;

export async function fetchCampaigns(): Promise<Campaign[]> {
  const j = await apiFetchJson<{ campaigns?: Campaign[] }>('/api/campaigns', {
    timeoutMs: CAMPAIGNS_API_TIMEOUT_MS,
  });
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
  stepIndex: number,
  connectionIds?: string[]
): Promise<number> {
  const path = `/api/campaigns/${encodeURIComponent(campaignId)}/retry-failed`;
  const j = await apiFetchJson<{ reset?: number; enqueued?: number; error?: string }>(path, {
    method: 'POST',
    body: JSON.stringify({ stepIndex, connectionIds })
  });
  if (j.error && !(j.enqueued && j.enqueued > 0)) {
    throw new Error(j.error);
  }
  return Number(j.enqueued ?? j.reset) || 0;
}

export async function redispatchCampaign(
  campaignId: string,
  body: {
    mode?: 'failed' | 'resume';
    connectionIds?: string[];
    phones?: string[];
    stepIndex?: number;
  }
): Promise<number> {
  const path = `/api/campaigns/${encodeURIComponent(campaignId)}/redispatch`;
  const j = await apiFetchJson<{ ok?: boolean; enqueued?: number; error?: string }>(path, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  if (j.ok === false) throw new Error(j.error || 'Falha ao reenviar campanha.');
  return Number(j.enqueued) || 0;
}

export type CampaignMediaAttachmentPayload = {
  dataBase64: string;
  mimeType: string;
  fileName: string;
  sendMediaAsDocument?: boolean;
};

export async function fetchCampaignMediaAttachments(campaignId: string): Promise<{
  mediaAttachment?: CampaignMediaAttachmentPayload;
  followUpMediaAttachment?: CampaignMediaAttachmentPayload;
}> {
  const path = `/api/campaigns/${encodeURIComponent(campaignId)}/media-attachments`;
  const j = await apiFetchJson<{
    ok?: boolean;
    mediaAttachment?: CampaignMediaAttachmentPayload;
    followUpMediaAttachment?: CampaignMediaAttachmentPayload;
  }>(path);
  if (j.ok === false) return {};
  return {
    ...(j.mediaAttachment ? { mediaAttachment: j.mediaAttachment } : {}),
    ...(j.followUpMediaAttachment ? { followUpMediaAttachment: j.followUpMediaAttachment } : {}),
  };
}

// ─── Saúde do motor de disparo ───────────────────────────────────────────────

export type DispatchHealthKind = 'ok' | 'redis_down' | 'misconfig' | 'network';

export type DispatchHealth = {
  ok: boolean;
  ready: boolean;
  kind?: DispatchHealthKind;
  /** Resposta HTTP recebida do servidor (false = timeout/rede no browser). */
  reachable?: boolean;
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ping unificado Redis + metadados (endpoint público, sem auth). */
export async function fetchDispatchHealth(options?: { retries?: number }): Promise<DispatchHealth> {
  const retries = Math.max(0, options?.retries ?? 2);
  let last: DispatchHealth = {
    ok: false,
    ready: false,
    kind: 'network',
    reachable: false,
    redis: { ok: false, error: 'Servidor inacessível ou timeout' },
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(apiUrl(`/api/health/dispatch?_=${Date.now()}`), {
        signal: AbortSignal.timeout(18_000),
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      const j = (await r.json().catch(() => ({}))) as Partial<DispatchHealth>;
      const redis = j.redis ?? { ok: false, error: 'Resposta inválida do servidor' };
      const ok = Boolean(j.ok);
      const kind: DispatchHealthKind = ok
        ? 'ok'
        : redis.misconfigHint
        ? 'misconfig'
        : 'redis_down';
      return {
        ok,
        ready: Boolean(j.ready),
        kind,
        reachable: true,
        redis,
        fixCommand: j.fixCommand,
        checkedAt: j.checkedAt ?? new Date().toISOString(),
      };
    } catch {
      if (attempt < retries) {
        await sleep(700 * (attempt + 1));
        continue;
      }
    }
  }

  return last;
}

/** GET /api/health/redis sem cache (evita 503 antigo preso no browser). */
export async function fetchRedisHealth(): Promise<{ ok: boolean; pingMs?: number; error?: string | null }> {
  try {
    const r = await fetch(apiUrl(`/api/health/redis?_=${Date.now()}`), {
      signal: AbortSignal.timeout(12_000),
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; pingMs?: number; error?: string | null };
    return { ok: Boolean(j.ok), pingMs: j.pingMs, error: j.error ?? null };
  } catch {
    return { ok: false, error: 'Servidor inacessível ou timeout' };
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

export type FrequencyCapContactResult = {
  phone: string;
  phoneKey: string;
  capped: boolean;
  lastSentAt?: string;
};

export type FrequencyCapCheckResult = {
  ok: boolean;
  total: number;
  cappedCount: number;
  readyCount: number;
  contacts: FrequencyCapContactResult[];
};

/** Verifica quais contatos já receberam mensagem nas últimas 24 h. */
export async function apiFrequencyCapCheck(phones: string[]): Promise<FrequencyCapCheckResult> {
  return apiFetchJson<FrequencyCapCheckResult>('/api/campaigns/frequency-cap-check', {
    method: 'POST',
    body: JSON.stringify({ phones })
  });
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
