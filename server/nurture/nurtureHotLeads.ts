import type { Contact } from '../../src/types.js';
import type { Conversation } from '../types.js';
import {
  buildPhoneMessageStatsIndex,
  mapContactToTempStats,
  type TempStats
} from '../../src/utils/contactTemperature.js';
import { filterByConnectionScope } from '../../src/utils/connectionScope.js';
import { normPhoneKey } from '../../src/utils/brPhoneNormalize.js';
import { getConversations } from '../evolutionService.js';
import { findContactByPhoneKey, listContacts } from '../repositories/contactsRepository.js';
import { enrollContactInNurture } from './nurtureEngine.js';
import type { NurtureJourneyRow } from './nurtureTypes.js';
import {
  findEnrollmentByPhonePg,
  getOrCreatePrimaryJourneyPg
} from './nurtureRepository.js';

const ACTIVE_ENROLLMENT = new Set(['enrolled', 'active', 'waiting_reply', 'paused']);

export type HotLeadCandidate = {
  contactId: string;
  name: string;
  phone: string;
  reason: 'opt_in' | 'engagement_hot';
  temp?: TempStats['temp'];
};

export function conversationsForTenant(tenantId: string): Conversation[] {
  return filterByConnectionScope(tenantId, getConversations());
}

/** Lead quente = opt-in de marketing OU temperatura hot (respondeu recentemente). */
export function isHotLeadForNurture(
  contact: Contact,
  phoneIndex: Record<string, Omit<TempStats, 'temp' | 'score'>>
): { hot: boolean; reason?: 'opt_in' | 'engagement_hot' } {
  if (contact.marketingOptOut) return { hot: false };
  if (contact.marketingOptIn) return { hot: true, reason: 'opt_in' };
  const stats = mapContactToTempStats(contact, phoneIndex);
  if (stats.temp === 'hot') return { hot: true, reason: 'engagement_hot' };
  return { hot: false };
}

export function resolveNurtureConnectionId(
  journey: NurtureJourneyRow,
  preferred?: string
): string {
  let connectionId = String(preferred ?? '').trim();
  if (!connectionId) {
    connectionId = String(journey.doc.entryRules.defaultConnectionId ?? '').trim();
  }
  if (!connectionId && journey.doc.connectionIds.length > 0) {
    connectionId = journey.doc.connectionIds[0];
  }
  return connectionId;
}

async function shouldAutoEnrollContact(
  tenantId: string,
  contact: Contact,
  journey: NurtureJourneyRow,
  phoneIndex: Record<string, Omit<TempStats, 'temp' | 'score'>>,
  opts?: { treatReplyAsHot?: boolean }
): Promise<{ enroll: boolean; reason?: 'opt_in' | 'engagement_hot' | 'reply' }> {
  const rules = journey.doc.entryRules;
  if (contact.marketingOptOut) return { enroll: false };

  if (rules.autoEnrollOnOptIn && contact.marketingOptIn) {
    return { enroll: true, reason: 'opt_in' };
  }

  if (opts?.treatReplyAsHot && rules.autoEnrollOnHotLead) {
    return { enroll: true, reason: 'reply' };
  }

  if (rules.autoEnrollOnHotLead) {
    const hot = isHotLeadForNurture(contact, phoneIndex);
    if (hot.hot && hot.reason === 'engagement_hot') {
      return { enroll: true, reason: 'engagement_hot' };
    }
  }

  return { enroll: false };
}

/** Auto-inscrição quando virar lead quente (opt-in, resposta ou engajamento). */
export async function tryAutoEnrollHotLead(params: {
  tenantId: string;
  phoneDigits: string;
  connectionId?: string;
  conversationId?: string;
  treatReplyAsHot?: boolean;
}): Promise<void> {
  try {
    const journey = await getOrCreatePrimaryJourneyPg(params.tenantId);
    if (!journey.enabled && !journey.doc.enabled) return;

    const rules = journey.doc.entryRules;
    if (!rules.autoEnrollOnOptIn && !rules.autoEnrollOnHotLead && !params.treatReplyAsHot) return;

    const phone = params.phoneDigits.replace(/\D/g, '');
    if (phone.length < 8) return;

    const existing = await findEnrollmentByPhonePg(params.tenantId, phone);
    if (existing && ACTIVE_ENROLLMENT.has(existing.status)) return;

    const contact =
      (await findContactByPhoneKey(params.tenantId, normPhoneKey(phone))) ||
      ({ id: '', name: '', phone, tags: [], status: 'VALID' as const } satisfies Contact);

    const phoneIndex = buildPhoneMessageStatsIndex(conversationsForTenant(params.tenantId));
    const decision = await shouldAutoEnrollContact(
      params.tenantId,
      contact,
      journey,
      phoneIndex,
      { treatReplyAsHot: params.treatReplyAsHot }
    );
    if (!decision.enroll) return;

    const connectionId = resolveNurtureConnectionId(journey, params.connectionId);
    if (!connectionId) {
      console.warn('[nurture] auto-enroll: nenhum chip configurado', phone);
      return;
    }

    await enrollContactInNurture({
      tenantId: params.tenantId,
      contactPhone: phone,
      connectionId,
      conversationId: params.conversationId || `${connectionId}:${phone}`,
      journeyId: journey.id
    });
  } catch (e) {
    console.warn('[nurture] auto-enroll falhou:', (e as Error)?.message);
  }
}

export type SyncHotLeadsResult = {
  scanned: number;
  enrolled: number;
  alreadyEnrolled: number;
  skipped: number;
  hotFound: number;
  samples: HotLeadCandidate[];
  hasMore: boolean;
  nextOffset: number;
  applied: boolean;
};

const SYNC_PAGE = 400;

/** Varre a base e inscreve leads quentes que ainda não estão na jornada. */
export async function syncHotLeadEnrollments(
  tenantId: string,
  opts: {
    offset?: number;
    limit?: number;
    dryRun?: boolean;
    connectionId?: string;
  } = {}
): Promise<SyncHotLeadsResult> {
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const limit = Math.min(Math.max(Number(opts.limit) || SYNC_PAGE, 1), SYNC_PAGE);
  const dryRun = opts.dryRun !== false;

  const journey = await getOrCreatePrimaryJourneyPg(tenantId);
  if (!journey.enabled && !journey.doc.enabled) {
    throw new Error('Ative a jornada antes de inscrever leads quentes.');
  }
  if (journey.doc.steps.length === 0) {
    throw new Error('Adicione pelo menos um passo na jornada.');
  }

  const connectionId = resolveNurtureConnectionId(journey, opts.connectionId);
  if (!connectionId) {
    throw new Error('Selecione um chip conectado na jornada.');
  }

  const page = await listContacts(tenantId, { limit, offset });
  const phoneIndex = buildPhoneMessageStatsIndex(conversationsForTenant(tenantId));

  let enrolled = 0;
  let alreadyEnrolled = 0;
  let skipped = 0;
  let hotFound = 0;
  const samples: HotLeadCandidate[] = [];

  for (const contact of page) {
    const hot = isHotLeadForNurture(contact, phoneIndex);
    if (!hot.hot) {
      skipped++;
      continue;
    }
    hotFound++;

    const phone = normPhoneKey(contact.phone);
    if (!phone) {
      skipped++;
      continue;
    }

    const existing = await findEnrollmentByPhonePg(tenantId, phone);
    if (existing && ACTIVE_ENROLLMENT.has(existing.status)) {
      alreadyEnrolled++;
      continue;
    }

    if (samples.length < 12) {
      samples.push({
        contactId: contact.id,
        name: contact.name || 'Sem nome',
        phone,
        reason: hot.reason || 'engagement_hot'
      });
    }

    if (dryRun) {
      enrolled++;
      continue;
    }

    const result = await enrollContactInNurture({
      tenantId,
      contactPhone: phone,
      connectionId,
      conversationId: `${connectionId}:${phone}`,
      journeyId: journey.id
    });
    if (result.ok) enrolled++;
    else skipped++;
  }

  return {
    scanned: page.length,
    enrolled,
    alreadyEnrolled,
    skipped,
    hotFound,
    samples,
    hasMore: page.length >= limit,
    nextOffset: offset + page.length,
    applied: !dryRun && enrolled > 0
  };
}

/** Lista leads quentes para inscrição manual na UI. */
export async function listHotLeadCandidates(
  tenantId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<{ items: HotLeadCandidate[]; hasMore: boolean; nextOffset: number }> {
  const limit = Math.min(Math.max(Number(opts.limit) || 40, 1), 100);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const page = await listContacts(tenantId, { limit, offset });
  const phoneIndex = buildPhoneMessageStatsIndex(conversationsForTenant(tenantId));
  const items: HotLeadCandidate[] = [];

  for (const contact of page) {
    const hot = isHotLeadForNurture(contact, phoneIndex);
    if (!hot.hot) continue;
    const phone = normPhoneKey(contact.phone);
    if (!phone) continue;
    const existing = await findEnrollmentByPhonePg(tenantId, phone);
    if (existing && ACTIVE_ENROLLMENT.has(existing.status)) continue;
    items.push({
      contactId: contact.id,
      name: contact.name || 'Sem nome',
      phone,
      reason: hot.reason || 'engagement_hot'
    });
    if (items.length >= limit) break;
  }

  return {
    items,
    hasMore: page.length >= limit,
    nextOffset: offset + page.length
  };
}
