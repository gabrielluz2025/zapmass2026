import type { ChatMessage, Conversation } from './types.js';
import { recipientKeyForCampaignReport } from '../src/utils/campaignReportDedupe.js';
import {
  firstReplyAfterCampaignSend,
  latestCampaignSendTimestampMs
} from '../src/utils/campaignReplyScope.js';

const MEDIA_LABEL: Record<string, string> = {
  image: '[Imagem]',
  video: '[Vídeo]',
  audio: '[Áudio]',
  document: '[Documento]',
  sticker: '[Figurinha]',
};

function replyDisplayText(msg: ChatMessage): string {
  const text = String(msg.text || '').trim();
  if (text) return text;
  const t = msg.type || 'text';
  return MEDIA_LABEL[t] || '';
}

/**
 * Respostas do contato só após envio **desta** campanha (fromCampaign + campaignId).
 * Não usa mensagens manuais nem envios de outras campanhas como referência.
 */
export function buildCampaignInboundRepliesMap(
  campaignId: string,
  conversations: Conversation[],
  allowedConnectionIds: string[]
): Record<string, { replyText: string; replyTimestampMs: number }> {
  const cid = String(campaignId || '').trim();
  if (!cid) return {};
  const allowed = new Set((allowedConnectionIds || []).filter(Boolean));
  const out: Record<string, { replyText: string; replyTimestampMs: number }> = {};

  for (const conv of conversations) {
    if (allowed.size > 0 && !allowed.has(conv.connectionId)) continue;
    const jidPart = conv.id.includes(':') ? conv.id.slice(conv.id.indexOf(':') + 1) : '';
    const phoneRaw = conv.contactPhone || jidPart.split('@')[0] || '';
    const rk = recipientKeyForCampaignReport(phoneRaw);
    if (!rk) continue;

    const msgs = conv.messages || [];
    const sendTs = latestCampaignSendTimestampMs(msgs, cid);
    if (!sendTs) continue;

    const reply = firstReplyAfterCampaignSend(msgs, sendTs);
    if (!reply) continue;
    const display = replyDisplayText(reply);
    if (!display) continue;
    const ts = reply.timestampMs || Date.now();
    const prev = out[rk];
    if (!prev || ts >= prev.replyTimestampMs) {
      out[rk] = { replyText: display, replyTimestampMs: ts };
    }
  }
  return out;
}
