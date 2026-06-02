import { listContacts } from './repositories/contactsRepository.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import type { Conversation } from './types.js';
import {
  buildCrmNameIndex,
  normalizePhoneDigits,
  pickContactDisplayName,
  resolveCrmNameFromIndex
} from '../src/utils/contactPhoneLookup.js';

const crmIndexCache = new Map<string, { at: number; index: ReturnType<typeof buildCrmNameIndex> }>();
const CRM_CACHE_MS = 45_000;

async function crmIndexForTenant(tenantUid: string) {
  const hit = crmIndexCache.get(tenantUid);
  if (hit && Date.now() - hit.at < CRM_CACHE_MS) return hit.index;
  const contacts = vpsDataEnabled() ? await listContacts(tenantUid, { limit: 8000 }) : [];
  const index = buildCrmNameIndex(contacts);
  crmIndexCache.set(tenantUid, { at: Date.now(), index });
  return index;
}

function phoneCandidatesFromConversation(conv: Conversation): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(conv.contactPhone || '');
  const stored = (conv.contactName || '').trim();
  const storedDigits = normalizePhoneDigits(stored);
  if (storedDigits.length >= 10 && storedDigits.length <= 13) push(`+${storedDigits}`);
  const idPart = conv.id.includes(':') ? conv.id.slice(conv.id.indexOf(':') + 1) : '';
  const fromJid = idPart.split('@')[0] || '';
  if (fromJid && !idPart.endsWith('@lid')) push(fromJid);
  return out;
}

export async function enrichConversationsWithCrmNames(
  tenantUid: string,
  list: Conversation[]
): Promise<Conversation[]> {
  if (!tenantUid || tenantUid === 'anonymous' || !vpsDataEnabled()) return list;
  const index = await crmIndexForTenant(tenantUid);
  if (index.size === 0) return list;

  return list.map((conv) => {
    const crm = resolveCrmNameFromIndex(index, ...phoneCandidatesFromConversation(conv));
    const nextName = pickContactDisplayName({
      crmName: crm,
      waName: conv.contactName,
      previous: conv.contactName
    });
    if (nextName === conv.contactName) return conv;
    return { ...conv, contactName: nextName };
  });
}
