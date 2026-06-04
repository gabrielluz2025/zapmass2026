import type { Contact, ContactList, Campaign } from '../types';
import { recipientKeyForCampaignReport } from './campaignReportDedupe';
import {
  buildReplyHintsFromLogs,
  CAMPAIGN_CONTACT_REPLY_LOG_MESSAGE,
  CAMPAIGN_REPLY_LOG_MESSAGE,
  CAMPAIGN_SENT_LOG_MESSAGE,
  campaignLogPayloadMatchesCampaign,
  logPayloadPhoneKey,
  type CampaignLogPayloadLike
} from './campaignReportFromLogs';
import { collectPlannedRecipientPhones, collectSentPhonesFromCampaignLogs } from './campaignReportScope';

const REPLY_MESSAGES = new Set([
  CAMPAIGN_REPLY_LOG_MESSAGE,
  CAMPAIGN_CONTACT_REPLY_LOG_MESSAGE
]);

export type LogRowInput = { timestamp: string; payload?: unknown };

export type BuiltReportRow = {
  id: string;
  phone: string;
  contactName: string;
  status: 'PENDING' | 'FAILED' | 'SENT' | 'DELIVERED' | 'READ' | 'REPLIED';
  sentTime: string;
  sentTimestampMs: number;
  replyText?: string;
  replyTime?: string;
  replyTimestampMs?: number;
  connectionId?: string;
  errorMessage?: string;
};

function findContactName(phone: string, contacts: Contact[]): string {
  const target = recipientKeyForCampaignReport(phone);
  for (const c of contacts) {
    if (recipientKeyForCampaignReport(c.phone) === target) return c.name;
  }
  return '';
}

/**
 * Relatório por contato derivado dos logs da campanha (fonte principal).
 * Garante REPLIED quando há log de resposta, independente do estado do chat.
 */
export function buildPrimaryReportRowsFromLogs(
  scopedLogs: LogRowInput[],
  campaignId: string,
  contacts: Contact[],
  campaign: Pick<Campaign, 'contactListId' | 'scheduleStartSnapshot' | 'totalContacts'>,
  contactLists: ContactList[]
): BuiltReportRow[] {
  const cid = String(campaignId || '').trim();
  if (!cid) return [];

  const sentPhones = collectSentPhonesFromCampaignLogs(scopedLogs, cid);
  const plannedPhones = collectPlannedRecipientPhones(campaign, contacts, contactLists);
  const replyHints = buildReplyHintsFromLogs(scopedLogs, cid);

  const phones = new Set<string>([...sentPhones, ...plannedPhones, ...replyHints.keys()]);

  type Acc = {
    phone: string;
    firstSentMs: number;
    lastSentMs: number;
    sentTime: string;
    connectionId?: string;
    status: BuiltReportRow['status'];
    errorMessage?: string;
    replyText?: string;
    replyTime?: string;
    replyTimestampMs?: number;
    id: string;
  };

  const byPhone = new Map<string, Acc>();

  const ensure = (phone: string): Acc => {
    let acc = byPhone.get(phone);
    if (!acc) {
      acc = {
        phone,
        firstSentMs: Number.MAX_SAFE_INTEGER,
        lastSentMs: 0,
        sentTime: '—',
        status: 'SENT',
        id: `log-${phone}`
      };
      byPhone.set(phone, acc);
    }
    return acc;
  };

  for (const phone of phones) ensure(phone);

  const sorted = [...scopedLogs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (const log of sorted) {
    if (!log.payload || typeof log.payload !== 'object') continue;
    const p = log.payload as CampaignLogPayloadLike;
    if (!campaignLogPayloadMatchesCampaign(p, cid)) continue;
    const msg = String(p.message || '');
    const phone = logPayloadPhoneKey(p);
    if (!phone) continue;
    const ts = new Date(log.timestamp).getTime();
    const acc = ensure(phone);

    if (msg === CAMPAIGN_SENT_LOG_MESSAGE) {
      if (ts < acc.firstSentMs) {
        acc.firstSentMs = ts;
        acc.sentTime = new Date(ts).toLocaleTimeString('pt-BR');
      }
      if (ts > acc.lastSentMs) acc.lastSentMs = ts;
      if (p.connectionId) acc.connectionId = p.connectionId;
      if (acc.status !== 'FAILED') acc.status = 'SENT';
      continue;
    }

    if (REPLY_MESSAGES.has(msg)) {
      acc.status = 'REPLIED';
      const preview = p.replyPreview ? String(p.replyPreview).trim() : '';
      if (!acc.replyTimestampMs || ts >= acc.replyTimestampMs) {
        acc.replyTimestampMs = ts;
        acc.replyTime = new Date(ts).toLocaleTimeString('pt-BR');
        if (preview) acc.replyText = preview;
      }
      if (p.connectionId) acc.connectionId = p.connectionId;
      continue;
    }

    if (log && String((log as { event?: string }).event || '').includes('error')) {
      acc.status = 'FAILED';
      acc.errorMessage = p.error || msg || 'Erro desconhecido';
    }
  }

  for (const [rk, hint] of replyHints) {
    const acc = ensure(rk);
    acc.status = 'REPLIED';
    if (hint.replyText) acc.replyText = hint.replyText;
    if (hint.replyTimestampMs) {
      acc.replyTimestampMs = hint.replyTimestampMs;
      acc.replyTime = new Date(hint.replyTimestampMs).toLocaleTimeString('pt-BR');
    }
    if (hint.connectionId) acc.connectionId = hint.connectionId;
  }

  const scopeOk = (phone: string) => {
    const rk = recipientKeyForCampaignReport(phone);
    if (sentPhones.size > 0) return sentPhones.has(rk);
    if (plannedPhones.size > 0) return plannedPhones.has(rk);
    return replyHints.has(rk);
  };

  return Array.from(byPhone.values())
    .filter((a) => scopeOk(a.phone))
    .map((a) => {
      const firstSent =
        a.firstSentMs !== Number.MAX_SAFE_INTEGER ? a.firstSentMs : a.lastSentMs || 0;
      return {
        id: a.id,
        phone: a.phone,
        contactName: findContactName(a.phone, contacts) || `+${a.phone}`,
        status: a.status,
        sentTime: a.sentTime !== '—' ? a.sentTime : firstSent ? new Date(firstSent).toLocaleTimeString('pt-BR') : '—',
        sentTimestampMs: firstSent || a.replyTimestampMs || 0,
        replyText: a.replyText,
        replyTime: a.replyTime,
        replyTimestampMs: a.replyTimestampMs,
        connectionId: a.connectionId,
        errorMessage: a.errorMessage
      };
    })
    .sort((a, b) => b.sentTimestampMs - a.sentTimestampMs);
}
