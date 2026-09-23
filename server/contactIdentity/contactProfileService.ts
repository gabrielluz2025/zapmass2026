import { isContactOptedOut } from '../contactOptOutService.js';
import { findContactByPhoneKey, phoneKeyForContact } from '../repositories/contactsRepository.js';
import { canonicalContactPhoneDigits, contactPhoneLookupVariants } from './contactPhone.js';
import {
  getContactIdentityRow,
  listContactEvents,
  type ContactEventRow,
} from './contactEventsRepository.js';
import { getZapmassPool } from '../db/postgres.js';
import { resolvePostgresTenantId } from '../auth/firebaseUidMap.js';

export type ContactProfileSnapshot = {
  phoneDigits: string;
  contactId: string | null;
  contactName: string | null;
  optedOut: boolean;
  leadScore: number;
  leadBand: string;
  preferredConnectionId: string | null;
  lastCampaignId: string | null;
  campaignStates: Array<{
    campaignId: string;
    status: string;
    stepIndex: number;
    replyText: string | null;
  }>;
  nurturePending: boolean;
  timeline: Array<{
    id: string;
    kind: string;
    at: string;
    connectionId: string | null;
    campaignId: string | null;
    summary: string;
  }>;
  mergedMessageCount: number;
};

function eventSummary(row: ContactEventRow): string {
  const p = row.payload || {};
  switch (row.kind) {
    case 'outbound_sent':
      return `Envio campanha${p.stage != null ? ` (etapa ${p.stage})` : ''}`;
    case 'inbound_reply':
      return String(p.preview || p.text || 'Resposta recebida').slice(0, 120);
    case 'opt_out':
      return 'Lista negra (opt-out)';
    case 'opt_in':
      return 'Opt-in registrado';
    case 'chip_failover':
      return `Failover ${p.from || '?'} → ${p.to || '?'}`;
    case 'reply_flow_step':
      return `Fluxo etapa ${p.step ?? '?'}`;
    default:
      return row.kind;
  }
}

export async function buildContactProfile(
  tenantId: string,
  phoneRaw: string
): Promise<ContactProfileSnapshot | null> {
  const phoneDigits = canonicalContactPhoneDigits(phoneRaw);
  if (phoneDigits.length < 8) return null;

  const optedOut = await isContactOptedOut(tenantId, phoneDigits);
  const identity = await getContactIdentityRow(tenantId, phoneDigits);
  const events = await listContactEvents(tenantId, phoneDigits, 40);

  let contactId: string | null = null;
  let contactName: string | null = null;
  for (const variant of contactPhoneLookupVariants(phoneDigits)) {
    const key = phoneKeyForContact(variant, variant);
    const c = await findContactByPhoneKey(tenantId, key).catch(() => null);
    if (c) {
      contactId = c.id;
      contactName = c.name;
      break;
    }
  }

  const campaignStates: ContactProfileSnapshot['campaignStates'] = [];
  if (contactId) {
    const pool = getZapmassPool();
    if (pool) {
      const tid = resolvePostgresTenantId(tenantId);
      const r = await pool.query<{
        campaign_id: string;
        status: string;
        current_step_index: number;
        reply_text: string | null;
      }>(
        `SELECT campaign_id::text, status, current_step_index, reply_text
           FROM zapmass.campaign_contact_state
          WHERE tenant_id = $1::uuid AND contact_id = $2
          ORDER BY updated_at DESC
          LIMIT 8`,
        [tid, contactId]
      );
      for (const row of r.rows) {
        campaignStates.push({
          campaignId: row.campaign_id,
          status: row.status,
          stepIndex: row.current_step_index,
          replyText: row.reply_text,
        });
      }
    }
  }

  let nurturePending = false;
  try {
    const pool = getZapmassPool();
    if (pool) {
      const tid = resolvePostgresTenantId(tenantId);
      const nr = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM zapmass.nurture_enrollments
          WHERE tenant_id = $1::uuid AND contact_phone = $2 AND status IN ('active', 'paused')`,
        [tid, phoneDigits]
      );
      nurturePending = parseInt(nr.rows[0]?.n || '0', 10) > 0;
    }
  } catch {
    /* nurture opcional */
  }

  let mergedMessageCount = 0;
  try {
    const { countArchivedMessagesByPhone } = await import('../repositories/chatArchiveRepository.js');
    const tid = resolvePostgresTenantId(tenantId);
    mergedMessageCount = await countArchivedMessagesByPhone(tid, phoneDigits);
  } catch {
    /* archive opcional */
  }

  return {
    phoneDigits,
    contactId,
    contactName,
    optedOut,
    leadScore: identity?.leadScore ?? 0,
    leadBand: optedOut ? 'blocked' : identity?.leadBand ?? 'cold',
    preferredConnectionId: identity?.preferredConnectionId ?? null,
    lastCampaignId: identity?.lastCampaignId ?? null,
    campaignStates,
    nurturePending,
    timeline: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      at: e.created_at.toISOString(),
      connectionId: e.connection_id,
      campaignId: e.campaign_id,
      summary: eventSummary(e),
    })),
    mergedMessageCount,
  };
}

export async function reconcileContactFromChannels(tenantId: string, phoneRaw: string): Promise<void> {
  const phoneDigits = canonicalContactPhoneDigits(phoneRaw);
  const { upsertPreferredConnection } = await import('./contactEventsRepository.js');
  const evo = await import('../evolutionService.js');
  const scoped = evo.getConnections().filter((c) => {
    const ou = evo.resolveConnectionOwnerUid(c.id);
    return ou === tenantId;
  });
  for (const conn of scoped) {
    if (String(conn.status || '').toUpperCase() !== 'CONNECTED') continue;
    await upsertPreferredConnection(tenantId, phoneDigits, conn.id);
    break;
  }
}
