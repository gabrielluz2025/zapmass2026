import { listContactNamePhones } from './repositories/contactsRepository.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { resolvePostgresTenantId } from './auth/firebaseUidMap.js';
import {
  buildCrmNameIndex,
  buildPhoneDigitLookupKeys,
  looksLikeLongLidDigits,
  normalizePhoneDigits
} from '../src/utils/contactPhoneLookup.js';
import {
  normalizeOutboundDigits,
  plausiblePhoneDigits
} from './evolutionLidResolve.js';

const CRM_CACHE_MS = 5 * 60_000;

export type CrmContactIndexes = {
  nameIndex: ReturnType<typeof buildCrmNameIndex>;
  byName: Map<string, string>;
  byDigits: Map<string, string>;
};

const cache = new Map<string, { at: number; indexes: CrmContactIndexes }>();

function normalizeNameKey(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

export function invalidateCrmContactIndexCache(tenantId?: string): void {
  if (tenantId) {
    cache.delete(resolvePostgresTenantId(tenantId));
    return;
  }
  cache.clear();
}

export async function getCrmContactIndexes(tenantUid: string): Promise<CrmContactIndexes> {
  const pgTenant = resolvePostgresTenantId(tenantUid);
  const hit = cache.get(pgTenant);
  if (hit && Date.now() - hit.at < CRM_CACHE_MS) return hit.indexes;

  const byName = new Map<string, string>();
  const byDigits = new Map<string, string>();
  const contacts = vpsDataEnabled() ? await listContactNamePhones(pgTenant, { limit: 10_000 }) : [];
  for (const ct of contacts) {
    const digits = normalizePhoneDigits(String(ct.phone || ''));
    if (plausiblePhoneDigits(digits) && !looksLikeLongLidDigits(digits)) {
      const e164 = normalizeOutboundDigits(digits);
      if (e164) {
        for (const key of buildPhoneDigitLookupKeys(digits)) {
          if (!byDigits.has(key)) byDigits.set(key, e164);
        }
      }
    }
    const nameKey = normalizeNameKey(ct.name || '');
    if (nameKey && nameKey !== 'contato' && !byName.has(nameKey)) {
      const e164 = normalizeOutboundDigits(digits);
      if (e164) byName.set(nameKey, e164);
    }
  }

  const indexes: CrmContactIndexes = {
    nameIndex: buildCrmNameIndex(contacts),
    byName,
    byDigits
  };
  cache.set(pgTenant, { at: Date.now(), indexes });
  return indexes;
}
