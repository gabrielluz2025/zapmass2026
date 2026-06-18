import { vpsDataEnabled } from './auth/dataMode.js';
import type { Conversation } from './types.js';
import { getCrmContactIndexes } from './crmContactIndexCache.js';
import {
  looksLikeDigitsOnlyPhoneLabel,
  looksLikeLongLidDigits,
  normalizePhoneDigits,
  phoneCandidatesFromConversation,
  resolveCrmNameFromIndex
} from '../src/utils/contactPhoneLookup.js';

function sameLabel(a: string, b: string): boolean {
  return a.toLowerCase().replace(/\s+/g, ' ') === b.toLowerCase().replace(/\s+/g, ' ');
}

function isInvalidChatLabel(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  if (looksLikeLongLidDigits(t)) return true;
  if (looksLikeDigitsOnlyPhoneLabel(t) && normalizePhoneDigits(t).length >= 14) return true;
  const lower = t.toLowerCase();
  return lower === 'contato' || lower === 'contact' || lower === 'unknown' || lower === 'desconhecido';
}

export async function enrichConversationsWithCrmNames(
  tenantUid: string,
  list: Conversation[]
): Promise<Conversation[]> {
  if (!tenantUid || tenantUid === 'anonymous' || !vpsDataEnabled()) return list;
  const { nameIndex: index } = await getCrmContactIndexes(tenantUid);
  if (index.size === 0) return list;

  return list.map((conv) => {
    const crm = resolveCrmNameFromIndex(index, ...phoneCandidatesFromConversation(conv));
    const waLabel = (conv.waContactName || conv.contactName || '').trim();
    const waOk = waLabel && !isInvalidChatLabel(waLabel) ? waLabel : '';

    if (!crm) {
      if (isInvalidChatLabel(conv.contactName || '') && waOk) {
        return { ...conv, contactName: waOk };
      }
      if (isInvalidChatLabel(conv.contactName || '')) {
        return { ...conv, contactName: 'Contato' };
      }
      return conv;
    }

    if (!waOk || sameLabel(crm, waOk)) {
      return { ...conv, contactName: crm };
    }
    return {
      ...conv,
      contactName: crm,
      waContactName: waOk
    };
  });
}
