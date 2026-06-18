/**
 * Destinatários elegíveis para retomar campanha quando não há campaign_contact_state
 * (ex.: fluxo por resposta — só usa RAM/logs, sem Postgres por contato).
 */
import type { Campaign } from '../src/types.js';
import {
  collectPlannedRecipientPhones,
  collectSentPhonesFromCampaignLogs,
} from '../src/utils/campaignReportScope.js';
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

/** Contatos da etapa 0 que ainda não receberam "Mensagem enviada" (snapshot + logs). */
export async function resolveUnsentStep0TargetsFromSnapshot(
  tenantId: string,
  campaignId: string,
  campaign: Pick<Campaign, 'contactListId' | 'scheduleStartSnapshot' | 'totalContacts'>
): Promise<Array<{ phone: string; stepIndex: number }>> {
  const logRows = await listCampaignLogs(tenantId, campaignId, { limit: 2000, offset: 0 });
  const logs = logsForSentDetection(logRows, campaignId);
  const sentPhones = collectSentPhonesFromCampaignLogs(logs, campaignId);
  const plannedPhones = collectPlannedRecipientPhones(campaign, [], []);

  const targets: Array<{ phone: string; stepIndex: number }> = [];
  for (const phone of plannedPhones) {
    if (!sentPhones.has(phone)) {
      targets.push({ phone, stepIndex: 0 });
    }
  }
  return targets;
}
