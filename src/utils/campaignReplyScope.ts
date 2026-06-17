import type { ChatMessage } from '../types';
import {
  CAMPAIGN_SENT_LOG_MESSAGE,
  campaignLogPayloadMatchesCampaign,
  type CampaignLogPayloadLike,
  logPayloadPhoneKey
} from './campaignReportFromLogs';
import { recipientKeyForCampaignReport } from './campaignReportDedupe';

/** Último envio desta campanha na conversa (só mensagens com fromCampaign + campaignId). */
export function latestCampaignSendTimestampMs(
  messages: ChatMessage[] | undefined,
  campaignId: string
): number {
  const cid = String(campaignId || '').trim();
  if (!cid) return 0;
  let max = 0;
  for (const m of messages || []) {
    if (m.sender !== 'me') continue;
    if (!m.fromCampaign || m.campaignId !== cid) continue;
    const ts = m.timestampMs || 0;
    if (ts > max) max = ts;
  }
  return max;
}

/** Primeira resposta do contato após o envio desta campanha (ignora chat antigo / outras campanhas). */
export function firstReplyAfterCampaignSend(
  messages: ChatMessage[] | undefined,
  sendTs: number
): ChatMessage | null {
  if (!sendTs || sendTs <= 0) return null;
  const minTs = sendTs - 2000;
  let best: ChatMessage | null = null;
  for (const m of messages || []) {
    if (m.sender !== 'them') continue;
    const ts = m.timestampMs || 0;
    if (ts <= 0 || ts < minTs) continue;
    if (!best || ts < (best.timestampMs ?? Infinity)) best = m;
  }
  return best;
}

/** Mapa telefone → timestamp do último log "Mensagem enviada" desta campanha. */
export function buildCampaignSendTimestampsFromLogs(
  logs: Array<{ timestamp: string; payload?: unknown }>,
  campaignId: string
): Map<string, number> {
  const cid = String(campaignId || '').trim();
  const out = new Map<string, number>();
  if (!cid) return out;
  for (const log of logs) {
    if (!log.payload || typeof log.payload !== 'object') continue;
    const p = log.payload as CampaignLogPayloadLike;
    if (!campaignLogPayloadMatchesCampaign(p, cid)) continue;
    if (String(p.message || '') !== CAMPAIGN_SENT_LOG_MESSAGE) continue;
    const rk = logPayloadPhoneKey(p);
    if (!rk) continue;
    const ts = new Date(log.timestamp).getTime();
    const prev = out.get(rk);
    if (!prev || ts >= prev) out.set(rk, ts);
  }
  return out;
}

/** Timestamp do último envio desta campanha para o telefone (via logs). */
export function latestCampaignSendTimestampFromLogs(
  logs: Array<{ timestamp: string; payload?: unknown }>,
  campaignId: string,
  phoneKey: string
): number {
  const rk = recipientKeyForCampaignReport(phoneKey);
  if (!rk) return 0;
  return buildCampaignSendTimestampsFromLogs(logs, campaignId).get(rk) || 0;
}

export function hasCampaignSendLogForPhone(
  logs: Array<{ timestamp: string; payload?: unknown }>,
  campaignId: string,
  phoneKey: string
): boolean {
  const cid = String(campaignId || '').trim();
  const rk = recipientKeyForCampaignReport(phoneKey);
  if (!cid || !rk) return false;
  for (const log of logs) {
    if (!log.payload || typeof log.payload !== 'object') continue;
    const p = log.payload as CampaignLogPayloadLike;
    if (!campaignLogPayloadMatchesCampaign(p, cid)) continue;
    if (String(p.message || '') !== CAMPAIGN_SENT_LOG_MESSAGE) continue;
    if (logPayloadPhoneKey(p) !== rk) continue;
    return true;
  }
  return false;
}
