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

export async function apiUpdateCampaign(
  id: string,
  patch: Record<string, unknown>,
  opts?: { timeoutMs?: number }
): Promise<void> {
  await apiFetchJson(`/api/campaigns/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
    timeoutMs: opts?.timeoutMs ?? CAMPAIGNS_API_TIMEOUT_MS,
  });
}

export type CampaignMediaAttachmentPayload = {
  dataBase64: string;
  mimeType: string;
  fileName: string;
  sendMediaAsDocument?: boolean;
};

/** ~18 MB binário com JSON_BODY_LIMIT_MB=25 na VPS (base64 infla ~33%). */
export const CAMPAIGN_MEDIA_API_SAFE_BYTES = 18 * 1024 * 1024;

const approxBytesFromBase64 = (base64: string): number => {
  const cleaned = base64.replace(/\s+/g, '');
  const len = cleaned.length;
  if (!len) return 0;
  let padding = 0;
  if (cleaned.endsWith('==')) padding = 2;
  else if (cleaned.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((len * 3) / 4) - padding);
};

/**
 * Grava anexo no servidor via REST (evita estourar maxHttpBufferSize do Socket.IO no start-campaign).
 * Retorna se o socket pode omitir o base64 (já está em disco na VPS).
 */
export async function fetchCampaignMediaAttachmentsStatus(
  campaignId: string
): Promise<{ opening: boolean; followUp: boolean }> {
  const path = `/api/campaigns/${encodeURIComponent(campaignId)}/media-attachments/status`;
  const j = await apiFetchJson<{ ok?: boolean; opening?: boolean; followUp?: boolean }>(path);
  if (j.ok === false) return { opening: false, followUp: false };
  return { opening: j.opening === true, followUp: j.followUp === true };
}

/** Persiste status/contadores após cura local (não sobrescreve pausa/agenda). */
export async function apiHealCampaignTerminalState(
  campaignId: string,
  patch: {
    status: string;
    processedCount?: number;
    successCount?: number;
    failedCount?: number;
  }
): Promise<void> {
  await apiUpdateCampaign(campaignId, {
    ...patch,
    allowTerminalStatusHeal: true,
  });
}

export function campaignMediaCanEmbedOnCreate(payload: {
  mediaAttachment?: CampaignMediaAttachmentPayload;
  followUpMediaAttachment?: CampaignMediaAttachmentPayload;
}): boolean {
  const parts = [payload.mediaAttachment?.dataBase64, payload.followUpMediaAttachment?.dataBase64].filter(
    Boolean
  ) as string[];
  if (!parts.length) return false;
  const approxBytes = parts.reduce((sum, b64) => sum + approxBytesFromBase64(b64), 0);
  return approxBytes > 0 && approxBytes <= CAMPAIGN_MEDIA_API_SAFE_BYTES;
}

export async function uploadCampaignDispatchMedia(
  campaignId: string,
  payload: {
    mediaAttachment?: CampaignMediaAttachmentPayload;
    followUpMediaAttachment?: CampaignMediaAttachmentPayload;
  },
  opts?: { skipIfOnServer?: boolean; onProgress?: (label: string) => void }
): Promise<{ uploadedViaApi: boolean; approxBytes: number; skippedBecauseOnServer?: boolean }> {
  const needsOpening = Boolean(payload.mediaAttachment?.dataBase64);
  const needsFollow = Boolean(payload.followUpMediaAttachment?.dataBase64);
  if (!needsOpening && !needsFollow) return { uploadedViaApi: false, approxBytes: 0 };

  if (opts?.skipIfOnServer) {
    try {
      const st = await fetchCampaignMediaAttachmentsStatus(campaignId);
      const openingOk = !needsOpening || st.opening;
      const followOk = !needsFollow || st.followUp;
      if (openingOk && followOk) {
        const onDisk = await fetchCampaignMediaAttachments(campaignId);
        const openingBytes = onDisk.mediaAttachment?.dataBase64
          ? approxBytesFromBase64(onDisk.mediaAttachment.dataBase64)
          : 0;
        const followBytes = onDisk.followUpMediaAttachment?.dataBase64
          ? approxBytesFromBase64(onDisk.followUpMediaAttachment.dataBase64)
          : 0;
        const openingVerified = !needsOpening || openingBytes > 0;
        const followVerified = !needsFollow || followBytes > 0;
        if (openingVerified && followVerified) {
          return { uploadedViaApi: true, approxBytes: 0, skippedBecauseOnServer: true };
        }
      }
    } catch {
      // segue com upload
    }
  }

  const parts = [payload.mediaAttachment?.dataBase64, payload.followUpMediaAttachment?.dataBase64].filter(
    Boolean
  ) as string[];
  const approxBytes = parts.reduce((sum, b64) => sum + approxBytesFromBase64(b64), 0);

  if (approxBytes > CAMPAIGN_MEDIA_API_SAFE_BYTES) {
    return { uploadedViaApi: false, approxBytes };
  }

  const mb = (approxBytes / (1024 * 1024)).toFixed(1);
  opts?.onProgress?.(`Enviando anexo para o servidor (${mb} MB)…`);

  const timeoutMs = Math.min(900_000, Math.max(120_000, 90_000 + Math.ceil(approxBytes / 25_000)));
  const patch: Record<string, unknown> = {};
  if (payload.mediaAttachment) patch.mediaAttachment = payload.mediaAttachment;
  if (payload.followUpMediaAttachment) patch.followUpMediaAttachment = payload.followUpMediaAttachment;
  await apiUpdateCampaign(campaignId, patch, { timeoutMs });
  return { uploadedViaApi: true, approxBytes };
}

/** Salva edição de campanha ativa/pausada sem reiniciar progresso. */
export async function saveCampaignEdit(
  campaignId: string,
  patch: Record<string, unknown>,
  channelIds: string[],
  extras?: {
    poolId?: string | null;
    channelWeights?: Record<string, number>;
    poolStrategy?: 'round_robin' | 'weighted' | 'priority';
  }
): Promise<{ remappedJobs: number; onlineCount: number }> {
  await apiUpdateCampaign(campaignId, patch);
  if (channelIds.length > 0) {
    return await updateCampaignChannels(campaignId, channelIds, {
      poolId: extras?.poolId ?? null,
      channelWeights: extras?.channelWeights,
      poolStrategy: extras?.poolStrategy
    });
  }
  return { remappedJobs: 0, onlineCount: 0 };
}

export async function apiDeleteCampaign(id: string): Promise<void> {
  await apiFetchJson(`/api/campaigns/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    timeoutMs: CAMPAIGNS_API_TIMEOUT_MS,
  });
}

export async function apiBulkDeleteCampaigns(
  ids: string[]
): Promise<{ deleted: string[]; missing: string[] }> {
  const j = await apiFetchJson<{ deleted?: string[]; missing?: string[] }>(
    '/api/campaigns/bulk-delete',
    {
      method: 'POST',
      body: JSON.stringify({ ids }),
      timeoutMs: CAMPAIGNS_API_TIMEOUT_MS,
    }
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

export type CampaignProspectingStatsDto = {
  total: number;
  replied: number;
  silent: number;
  maxSilentWave: number;
  pendingInitial: number;
};

export async function fetchCampaignProspectingStats(campaignId: string): Promise<{
  stats: CampaignProspectingStatsDto;
  prospecting: import('../types').CampaignProspecting | null;
}> {
  const path = `/api/campaigns/${encodeURIComponent(campaignId)}/prospecting-stats`;
  const j = await apiFetchJson<{
    stats?: CampaignProspectingStatsDto;
    prospecting?: import('../types').CampaignProspecting | null;
  }>(path);
  return {
    stats: j.stats ?? { total: 0, replied: 0, silent: 0, maxSilentWave: 0, pendingInitial: 0 },
    prospecting: j.prospecting ?? null
  };
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

/** Altera chips de disparo de campanha ativa/pausada. */
export async function updateCampaignChannels(
  campaignId: string,
  connectionIds: string[],
  extras?: {
    poolId?: string | null;
    channelWeights?: Record<string, number>;
    poolStrategy?: 'round_robin' | 'weighted' | 'priority';
  }
): Promise<{ remappedJobs: number; onlineCount: number }> {
  const path = `/api/campaigns/${encodeURIComponent(campaignId)}/channels`;
  const j = await apiFetchJson<{
    ok?: boolean;
    remappedJobs?: number;
    onlineCount?: number;
    error?: string;
  }>(path, {
    method: 'POST',
    body: JSON.stringify({
      connectionIds,
      ...(extras?.poolId !== undefined ? { poolId: extras.poolId } : {}),
      ...(extras?.channelWeights ? { channelWeights: extras.channelWeights } : {}),
      ...(extras?.poolStrategy ? { poolStrategy: extras.poolStrategy } : {}),
    }),
  });
  if (j.ok === false) throw new Error(j.error || 'Não foi possível alterar os chips.');
  return {
    remappedJobs: Number(j.remappedJobs) || 0,
    onlineCount: Number(j.onlineCount) || 0,
  };
}

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

/** Mensagem amigável quando o motor de disparo (Redis/fila) não está pronto. */
export function formatDispatchUnavailableMessage(h: DispatchHealth): string {
  if (h.reachable === false) {
    return 'Não conseguimos contactar o servidor agora. Aguarde 1 minuto, atualize a página (F5) e tente de novo.';
  }
  if (h.kind === 'misconfig' || h.redis.misconfigHint) {
    return 'A fila de envio (Redis) na VPS está com configuração antiga — o disparo fica bloqueado até o deploy corrigir. Aguarde alguns minutos ou avise o suporte técnico.';
  }
  const detail = h.redis.error?.trim();
  if (detail) {
    return `Fila de envio indisponível (${detail}). O servidor pode estar sobrecarregado — tente de novo em 1–2 minutos.`;
  }
  return 'O motor de envio está temporariamente indisponível. Aguarde alguns segundos e tente novamente.';
}

/** POST /api/health/dispatch/reconnect — recria conexão e re-testa (sem cache). */
export async function reconnectDispatchHealth(): Promise<DispatchHealth> {
  try {
    const r = await fetch(apiUrl('/api/health/dispatch/reconnect'), {
      method: 'POST',
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    const j = (await r.json().catch(() => ({}))) as Partial<DispatchHealth>;
    const redis = j.redis ?? { ok: false, error: 'Resposta inválida do servidor' };
    const ok = Boolean(j.ok);
    return {
      ok,
      ready: Boolean(j.ready),
      kind: ok ? 'ok' : redis.misconfigHint ? 'misconfig' : 'redis_down',
      reachable: true,
      redis,
      fixCommand: j.fixCommand,
      checkedAt: j.checkedAt ?? new Date().toISOString(),
    };
  } catch {
    return {
      ok: false,
      ready: false,
      kind: 'network',
      reachable: false,
      redis: { ok: false, error: 'Servidor inacessível ou timeout' },
    };
  }
}

/**
 * Garante motor de disparo pronto antes de iniciar campanha.
 * Retenta com backoff e tenta reconectar automaticamente antes de falhar.
 */
export async function ensureDispatchReady(options?: {
  maxAttempts?: number;
  tryReconnect?: boolean;
  /** Falha rápido em misconfig de REDIS_URL (sem várias tentativas). */
  failFastOnMisconfig?: boolean;
}): Promise<DispatchHealth> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 4);
  const failFastOnMisconfig = options?.failFastOnMisconfig !== false;
  let last = await fetchDispatchHealth({ retries: 0 });
  if (!last.kind) {
    last = {
      ...last,
      kind: last.ok ? 'ok' : last.reachable === false ? 'network' : last.redis.misconfigHint ? 'misconfig' : 'redis_down',
    };
  }
  if (last.ok) return last;
  if (failFastOnMisconfig && last.kind === 'misconfig') return last;

  for (let attempt = 1; attempt < maxAttempts; attempt++) {
    await sleep(600 * attempt);
    if (options?.tryReconnect !== false && attempt >= 2) {
      last = await reconnectDispatchHealth();
      if (last.ok) return last;
      if (failFastOnMisconfig && last.kind === 'misconfig') return last;
    }
    last = await fetchDispatchHealth({ retries: 0 });
    if (last.ok) return last;
    if (failFastOnMisconfig && last.kind === 'misconfig') return last;
  }
  return last;
}

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
        signal: AbortSignal.timeout(8_000),
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
  const h = await ensureDispatchReady({ maxAttempts: 3, tryReconnect: true });
  return {
    ok: h.ok,
    pingMs: h.redis.pingMs,
    error: h.ok ? null : h.redis.error ?? null,
  };
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
    body: JSON.stringify({ connectionIds }),
    timeoutMs: 18_000,
    retries: 2,
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

export type CampaignRecipientWaVerifyResult = 'found' | 'corrected' | 'missing' | 'invalid_format' | 'uncertain';

export type CampaignRecipientPhoneVerifyBatch = {
  ok: boolean;
  results: Array<{ phone: string; result: CampaignRecipientWaVerifyResult; canonical?: string }>;
  summary: {
    onWhatsApp: number;
    phoneCorrected: number;
    notOnWhatsApp: number;
    invalidFormat: number;
    uncertain: number;
  };
  hasMore: boolean;
  nextOffset: number;
  connectionId: string;
  error?: string;
};

/** Verifica presença no WhatsApp (Evolution) para números de planilha — em lotes. */
export async function apiVerifyCampaignRecipientPhones(opts: {
  phones: string[];
  connectionId?: string;
  offset?: number;
  limit?: number;
}): Promise<CampaignRecipientPhoneVerifyBatch> {
  const j = await apiFetchJson<CampaignRecipientPhoneVerifyBatch>(
    '/api/campaigns/verify-recipient-phones',
    {
      method: 'POST',
      body: JSON.stringify({
        phones: opts.phones,
        connectionId: opts.connectionId,
        offset: opts.offset ?? 0,
        limit: opts.limit ?? 80,
      }),
      timeoutMs: 120_000,
      retries: 0,
    }
  );
  if (j.ok === false) {
    throw new Error(j.error || 'Falha ao verificar números no WhatsApp.');
  }
  return j;
}

/** Verifica quais contatos já receberam mensagem nas últimas 24 h. */
export async function apiFrequencyCapCheck(phones: string[]): Promise<FrequencyCapCheckResult> {
  return apiFetchJson<FrequencyCapCheckResult>('/api/campaigns/frequency-cap-check', {
    method: 'POST',
    body: JSON.stringify({ phones }),
    timeoutMs: 20_000,
    retries: 2,
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

/** Verifica se algum dos contatos selecionados já está programado em campanhas ativas. */
export async function apiCheckScheduledDuplicates(
  phones: string[]
): Promise<Array<{ phone: string; campaignName: string; campaignId: string }>> {
  const j = await apiFetchJson<{ duplicates?: Array<{ phone: string; campaignName: string; campaignId: string }> }>(
    '/api/campaigns/check-scheduled-duplicates',
    {
      method: 'POST',
      body: JSON.stringify({ phones }),
      timeoutMs: 8_000,
      retries: 1,
    }
  );
  return Array.isArray(j.duplicates) ? j.duplicates : [];
}
