import { listContacts } from './repositories/contactsRepository.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { resolvePostgresTenantId } from './auth/firebaseUidMap.js';
import type { Conversation } from './types.js';
import {
  buildCrmNameIndex,
  normalizePhoneDigits,
  resolveCrmNameFromIndex
} from '../src/utils/contactPhoneLookup.js';

const crmIndexCache = new Map<string, { at: number; index: ReturnType<typeof buildCrmNameIndex> }>();
const CRM_CACHE_MS = 45_000;

async function crmIndexForTenant(tenantUid: string) {
  const pgTenant = resolvePostgresTenantId(tenantUid);
  const hit = crmIndexCache.get(pgTenant);
  if (hit && Date.now() - hit.at < CRM_CACHE_MS) return hit.index;
  const contacts = vpsDataEnabled() ? await listContacts(pgTenant, { limit: 8000 }) : [];
  const index = buildCrmNameIndex(contacts);
  crmIndexCache.set(pgTenant, { at: Date.now(), index });
  return index;
}

function phoneCandidatesFromConversation(conv: Conversation): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(conv.contactPhone || '');
  if (conv.waJidAlt) {
    const altDigits = conv.waJidAlt.split('@')[0] || '';
    if (altDigits && !altDigits.endsWith('@lid')) push(altDigits);
  }
  const stored = (conv.waContactName || conv.contactName || '').trim();
  const storedDigits = normalizePhoneDigits(stored);
  if (storedDigits.length >= 10 && storedDigits.length <= 13) push(`+${storedDigits}`);
  const idPart = conv.id.includes(':') ? conv.id.slice(conv.id.indexOf(':') + 1) : '';
  const fromJid = idPart.split('@')[0] || '';
  if (fromJid && !idPart.endsWith('@lid')) push(fromJid);
  return out;
}

function sameLabel(a: string, b: string): boolean {
  return a.toLowerCase().replace(/\s+/g, ' ') === b.toLowerCase().replace(/\s+/g, ' ');
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
    if (!crm) return conv;
    const waLabel = (conv.waContactName || conv.contactName || '').trim();
    if (!waLabel || sameLabel(crm, waLabel)) {
      return { ...conv, contactName: crm };
    }
    return {
      ...conv,
      contactName: crm,
      waContactName: waLabel
    };
  });
}
