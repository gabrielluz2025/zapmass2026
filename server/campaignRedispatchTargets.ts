/**
 * Destinatários elegíveis para retomar campanha quando não há campaign_contact_state
 * (ex.: fluxo por resposta — só usa RAM/logs, sem Postgres por contato).
 */
import type { Campaign } from '../src/types.js';
import { recipientKeyForCampaignReport } from '../src/utils/campaignReportDedupe.js';
import {
  collectPlannedRecipientPhones,
  collectSentPhonesFromCampaignLogs,
} from '../src/utils/campaignReportScope.js';
import { getZapmassPool } from './db/postgres.js';
import { listCampaignLogs, type CampaignLogRow } from './repositories/campaignsRepository.js';

function logsForSentDetection(logRows: CampaignLogRow[], campaignId: string) {
  return logRows.map((r) => {
    const p = (r.payload || {}) as Record<string, unknown>;
    return {
      timestamp: r.created_at.toISOString(),
      payload: {
        ...p,
        campaignId: String(p.campaignId || campaignId),
        message: String(r.message || p.message || ''),
        to: String(p.to || p.phoneDigits || ''),
        phoneDigits: String(p.phoneDigits || p.to || ''),
      },
    };
  });
}

async function loadPhonesFromContactList(tenantId: string, listId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const pool = getZapmassPool();
  if (!pool) return out;
  const { getContactListById } = await import('./repositories/contactListsRepository.js');
  const list = await getContactListById(tenantId, listId);
  const ids = list?.contactIds?.filter(Boolean) || [];
  if (!ids.length) return out;
  const r = await pool.query<{ phone: string }>(
    `SELECT phone FROM zapmass.contacts
     WHERE tenant_id = $1::uuid AND id = ANY($2::uuid[])`,
    [tenantId, ids]
  );
  for (const row of r.rows) {
    const rk = recipientKeyForCampaignReport(row.phone);
    if (rk) out.add(rk);
  }
  return out;
}

/** Planejados: união snapshot + lista (snapshot parcial não pode esconder contatos da lista). */
async function resolvePlannedPhonesForRedispatch(
  tenantId: string,
  campaign: Pick<Campaign, 'contactListId' | 'scheduleStartSnapshot' | 'totalContacts'>
): Promise<Set<string>> {
  const fromSnapshot = collectPlannedRecipientPhones(campaign, [], []);
  const merged = new Set(fromSnapshot);

  const listId = campaign.contactListId?.trim();
  if (listId) {
    const fromList = await loadPhonesFromContactList(tenantId, listId);
    for (const phone of fromList) merged.add(phone);
  }

  return merged;
}

/** Contatos da etapa 0 que ainda não receberam "Mensagem enviada" (snapshot/lista + logs). */
export async function resolveUnsentStep0TargetsFromSnapshot(
  tenantId: string,
  campaignId: string,
  campaign: Pick<Campaign, 'contactListId' | 'scheduleStartSnapshot' | 'totalContacts'>
): Promise<Array<{ phone: string; stepIndex: number }>> {
  const logRows = await listCampaignLogs(tenantId, campaignId, { limit: 2000, offset: 0 });
  const logs = logsForSentDetection(logRows, campaignId);
  const sentPhones = collectSentPhonesFromCampaignLogs(logs, campaignId);
  const plannedPhones = await resolvePlannedPhonesForRedispatch(tenantId, campaign);

  const targets: Array<{ phone: string; stepIndex: number }> = [];
  for (const phone of plannedPhones) {
    if (!sentPhones.has(phone)) {
      targets.push({ phone, stepIndex: 0 });
    }
  }
  return targets;
}
