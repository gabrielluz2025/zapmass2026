import type { ChatMessage, Conversation } from './types.js';
import { recipientKeyForCampaignReport } from '../src/utils/campaignReportDedupe.js';

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
 * Busca respostas do contato no histórico completo do servidor (sem limite de 25 msgs do socket).
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
    if (!rk) continue;

    const msgs = conv.messages || [];
    let sendTs = 0;
    for (const m of msgs) {
      if (m.sender !== 'me') continue;
      if (m.fromCampaign && m.campaignId === cid) {
        sendTs = Math.max(sendTs, m.timestampMs || 0);
      }
    }
    if (!sendTs) {
      for (const m of msgs) {
        if (m.sender === 'me' && (m.timestampMs || 0) > 0) {
          sendTs = sendTs ? Math.min(sendTs, m.timestampMs || sendTs) : m.timestampMs || 0;
        }
      }
    }

    for (const m of msgs) {
      if (m.sender !== 'them') continue;
      const ts = m.timestampMs || 0;
      if (sendTs > 0 && ts > 0 && ts < sendTs - 2000) continue;
      const display = replyDisplayText(m);
      if (!display) continue;
      const prev = out[rk];
      if (!prev || ts >= prev.replyTimestampMs) {
        out[rk] = { replyText: display, replyTimestampMs: ts || Date.now() };
      }
    }
  }
  return out;
}
