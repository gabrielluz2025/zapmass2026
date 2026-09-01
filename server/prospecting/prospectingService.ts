import type { CampaignProspecting } from '../../src/types.js';
import {
  dayOfWeekForCalendarDateInZone,
  localDateTimeToUtcIso
} from '../../src/utils/campaignSchedule.js';
import { normPhoneKey } from '../../src/utils/brPhoneNormalize.js';
import { resolvePostgresTenantId } from '../auth/firebaseUidMap.js';
import { phoneContactIdVariants } from '../campaignFlowContinuation.js';
import { usePostgresCampaigns } from '../campaignStore.js';
import { enrollContactInNurture } from '../nurture/nurtureEngine.js';
import { createCampaignProspectingJourneyPg } from '../nurture/nurtureRepository.js';
import {
  advanceProspectingSilentWave,
  bulkInitContactStates,
  getProspectingContactStats,
  listProspectingSilentContactsForBump,
  markProspectingInitialSent,
  recordProspectingReply
} from '../repositories/campaignContactStateRepository.js';
import { getCampaign, mergeUpdateCampaign } from '../repositories/campaignsRepository.js';

const PROSPECTING_TZ = 'America/Sao_Paulo';

function formatYmdInZone(ms: number, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = fmt.formatToParts(new Date(ms));
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${year}-${month}-${day}`;
}

/** Próxima janela de lembrete (≥6 dias após `afterMs`, no dia/hora configurados). */
export function computeNextProspectingBumpAt(
  afterMs: number,
  bumpWeekday: number,
  bumpTime: string,
  timeZone = PROSPECTING_TZ
): string {
  const minMs = afterMs + 6 * 24 * 60 * 60 * 1000;
  const wd = Math.min(6, Math.max(0, Math.round(bumpWeekday)));
  const time = String(bumpTime || '10:00').trim().slice(0, 5) || '10:00';

  for (let dayOffset = 0; dayOffset < 21; dayOffset++) {
    const probeMs = minMs + dayOffset * 24 * 60 * 60 * 1000;
    const dateStr = formatYmdInZone(probeMs, timeZone);
    if (dayOfWeekForCalendarDateInZone(dateStr, timeZone) !== wd) continue;
    const iso = localDateTimeToUtcIso(dateStr, time, timeZone);
    if (iso && Date.parse(iso) > afterMs) return iso;
  }
  return new Date(minMs + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeProspecting(raw: unknown): CampaignProspecting | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.enabled !== true) return null;
  const silentWeeks = Math.min(12, Math.max(1, Math.round(Number(o.silentWeeks) || 4)));
  const silentBumpBody = String(o.silentBumpBody || '').trim();
  if (!silentBumpBody) return null;
  return {
    enabled: true,
    silentWeeks,
    silentBumpBody,
    bumpWeekday: Math.min(6, Math.max(0, Math.round(Number(o.bumpWeekday) || 2))),
    bumpTime: String(o.bumpTime || '10:00').trim().slice(0, 5) || '10:00',
    responderJourneyId:
      typeof o.responderJourneyId === 'string' ? o.responderJourneyId : undefined,
    responderSteps: Array.isArray(o.responderSteps)
      ? (o.responderSteps as CampaignProspecting['responderSteps'])
      : undefined,
    campaignStartedAt:
      typeof o.campaignStartedAt === 'string' ? o.campaignStartedAt : undefined,
    nextBumpAt: typeof o.nextBumpAt === 'string' ? o.nextBumpAt : undefined,
    lastBumpAt: typeof o.lastBumpAt === 'string' ? o.lastBumpAt : undefined,
    silentWaveIndex: Number(o.silentWaveIndex) || 0,
    active: o.active !== false
  };
}

/** Inicializa prospecção ao iniciar campanha (jornada + estados + próximo bump). */
export async function setupProspectingOnCampaignStart(params: {
  tenantId: string;
  campaignId: string;
  campaignName: string;
  phones: string[];
  connectionIds: string[];
  prospecting: CampaignProspecting;
}): Promise<CampaignProspecting> {
  if (!usePostgresCampaigns()) return params.prospecting;

  const campaign = await getCampaign(params.tenantId, params.campaignId);
  const campaignName = campaign?.name?.trim() || params.campaignName || 'Prospecção';

  const pgTenantId = resolvePostgresTenantId(params.tenantId);
  const cleanPhones = params.phones.map((p) => normPhoneKey(p)).filter((p) => p.length >= 8);
  await bulkInitContactStates(pgTenantId, params.campaignId, cleanPhones);

  let journeyId = params.prospecting.responderJourneyId;
  if (!journeyId && params.prospecting.responderSteps?.length) {
    const journey = await createCampaignProspectingJourneyPg(
      params.tenantId,
      campaignName,
      params.connectionIds,
      params.prospecting.responderSteps
    );
    journeyId = journey.id;
  }

  const startedAt = new Date().toISOString();
  const nextBumpAt = computeNextProspectingBumpAt(
    Date.now(),
    params.prospecting.bumpWeekday,
    params.prospecting.bumpTime
  );

  const updated: CampaignProspecting = {
    ...params.prospecting,
    enabled: true,
    active: true,
    responderJourneyId: journeyId,
    campaignStartedAt: startedAt,
    silentWaveIndex: 0,
    nextBumpAt,
    lastBumpAt: undefined
  };

  await mergeUpdateCampaign(params.tenantId, params.campaignId, { prospecting: updated });
  return updated;
}

export async function markProspectingWave0Sent(
  campaignId: string,
  phoneDigits: string
): Promise<void> {
  if (!usePostgresCampaigns()) return;
  const phone = normPhoneKey(phoneDigits);
  if (!phone) return;
  for (const variant of phoneContactIdVariants(phone)) {
    await markProspectingInitialSent(campaignId, variant);
  }
}

export async function markProspectingSilentBumpSent(
  campaignId: string,
  phoneDigits: string,
  maxSilentWeeks: number
): Promise<void> {
  if (!usePostgresCampaigns()) return;
  const phone = normPhoneKey(phoneDigits);
  if (!phone) return;
  for (const variant of phoneContactIdVariants(phone)) {
    await advanceProspectingSilentWave(campaignId, variant, maxSilentWeeks);
  }
}

/** Inbound: grava resposta e inscreve na jornada da campanha. */
export async function tryHandleProspectingReply(params: {
  tenantId: string;
  campaignId: string;
  phoneDigits: string;
  connectionId: string;
  conversationId?: string;
  replyText: string;
}): Promise<boolean> {
  if (!usePostgresCampaigns()) return false;

  const campaign = await getCampaign(params.tenantId, params.campaignId);
  const prospecting = normalizeProspecting(campaign?.prospecting);
  if (!prospecting?.responderJourneyId) return false;

  const phone = normPhoneKey(params.phoneDigits);
  if (!phone) return false;

  let recorded = false;
  for (const variant of phoneContactIdVariants(phone)) {
    if (await recordProspectingReply(params.campaignId, variant, params.replyText)) {
      recorded = true;
      break;
    }
  }
  if (!recorded) return false;

  await enrollContactInNurture({
    tenantId: params.tenantId,
    contactPhone: phone,
    connectionId: params.connectionId,
    conversationId: params.conversationId || `${params.connectionId}:${phone}`,
    journeyId: prospecting.responderJourneyId
  });

  return true;
}

export type DueProspectingCampaign = {
  tenantId: string;
  campaignId: string;
  name: string;
  prospecting: CampaignProspecting;
  connectionIds: string[];
};

export async function listDueProspectingCampaigns(limit = 15): Promise<DueProspectingCampaign[]> {
  const { getZapmassPool } = await import('../db/postgres.js');
  const pool = getZapmassPool();
  if (!pool) return [];

  const r = await pool.query<{
    id: string;
    tenant_id: string;
    name: string;
    doc: Record<string, unknown>;
  }>(
    `SELECT c.id::text, c.tenant_id::text, c.name, c.doc
     FROM zapmass.campaigns c
     WHERE c.doc->'prospecting'->>'enabled' = 'true'
       AND COALESCE(c.doc->'prospecting'->>'active', 'true') = 'true'
       AND c.doc->'prospecting'->>'nextBumpAt' IS NOT NULL
       AND (c.doc->'prospecting'->>'nextBumpAt')::timestamptz <= now()
     ORDER BY (c.doc->'prospecting'->>'nextBumpAt')::timestamptz ASC
     LIMIT $1`,
    [limit]
  );

  const out: DueProspectingCampaign[] = [];
  for (const row of r.rows) {
    const doc = row.doc || {};
    const prospecting = normalizeProspecting(doc.prospecting);
    if (!prospecting) continue;
    const ownerUid = String(doc.ownerUid || '').trim();
    if (!ownerUid) continue;
    const connectionIds = Array.isArray(doc.selectedConnectionIds)
      ? (doc.selectedConnectionIds as string[])
      : Array.isArray(doc.connectionIds)
        ? (doc.connectionIds as string[])
        : [];
    if (connectionIds.length === 0) continue;
    out.push({
      tenantId: ownerUid,
      campaignId: row.id,
      name: row.name,
      prospecting,
      connectionIds
    });
  }
  return out;
}

export async function runProspectingSilentBumpWave(
  row: DueProspectingCampaign,
  enqueue: (params: {
    campaignId: string;
    ownerUid: string;
    connectionId: string;
    to: string;
    message: string;
    rotationIndex: number;
    delayMs: number;
    contactId: string;
    waveIndex: number;
    maxSilentWeeks: number;
  }) => Promise<void>
): Promise<{ enqueued: number; skipped: boolean }> {
  const { isChipQuietMode } = await import('../chipProtectionService.js');
  if (await isChipQuietMode(row.tenantId)) {
    return { enqueued: 0, skipped: true };
  }

  const waveIndex = (row.prospecting.silentWaveIndex ?? 0) + 1;
  if (waveIndex > row.prospecting.silentWeeks) {
    await mergeUpdateCampaign(row.tenantId, row.campaignId, {
      prospecting: { ...row.prospecting, active: false, nextBumpAt: undefined }
    });
    return { enqueued: 0, skipped: true };
  }

  const contacts = await listProspectingSilentContactsForBump(
    row.campaignId,
    waveIndex - 1
  );
  if (contacts.length === 0) {
    const nextBumpAt = computeNextProspectingBumpAt(
      Date.now(),
      row.prospecting.bumpWeekday,
      row.prospecting.bumpTime
    );
    await mergeUpdateCampaign(row.tenantId, row.campaignId, {
      prospecting: {
        ...row.prospecting,
        silentWaveIndex: waveIndex,
        lastBumpAt: new Date().toISOString(),
        nextBumpAt: waveIndex >= row.prospecting.silentWeeks ? undefined : nextBumpAt,
        active: waveIndex < row.prospecting.silentWeeks
      }
    });
    return { enqueued: 0, skipped: false };
  }

  const message = row.prospecting.silentBumpBody;
  let enqueued = 0;
  const baseDelay = 0;
  const staggerMs = 3500;

  for (let i = 0; i < contacts.length; i++) {
    const contactId = contacts[i];
    const connectionId = row.connectionIds[i % row.connectionIds.length];
    await enqueue({
      campaignId: row.campaignId,
      ownerUid: row.tenantId,
      connectionId,
      to: contactId,
      message,
      rotationIndex: i,
      delayMs: baseDelay + i * staggerMs,
      contactId,
      waveIndex,
      maxSilentWeeks: row.prospecting.silentWeeks
    });
    enqueued++;
  }

  const nextBumpAt =
    waveIndex >= row.prospecting.silentWeeks
      ? undefined
      : computeNextProspectingBumpAt(
          Date.now(),
          row.prospecting.bumpWeekday,
          row.prospecting.bumpTime
        );

  await mergeUpdateCampaign(row.tenantId, row.campaignId, {
    prospecting: {
      ...row.prospecting,
      silentWaveIndex: waveIndex,
      lastBumpAt: new Date().toISOString(),
      nextBumpAt,
      active: waveIndex < row.prospecting.silentWeeks
    }
  });

  return { enqueued, skipped: false };
}

export { getProspectingContactStats };
