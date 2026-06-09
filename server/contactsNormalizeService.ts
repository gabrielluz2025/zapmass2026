import type { Contact } from '../src/types.js';
import {
  applyAddressNormalizationToContact,
  contactAddressChanged,
  normalizeContactAddressFields
} from '../src/utils/contactAddressNormalize.js';
import { bulkUpdateContacts, listContacts } from './repositories/contactsRepository.js';

export type NormalizeAddressesResult = {
  scanned: number;
  updated: number;
  samples: Array<{ from: string; to: string }>;
};

export async function normalizeTenantContactAddresses(tenantId: string): Promise<NormalizeAddressesResult> {
  const PAGE = 5000;
  let offset = 0;
  let scanned = 0;
  let updated = 0;
  const samples: Array<{ from: string; to: string }> = [];
  const sampleKeys = new Set<string>();

  while (true) {
    const page = await listContacts(tenantId, { limit: PAGE, offset });
    if (page.length === 0) break;

    const items: Array<{ id: string; updates: Partial<Contact> }> = [];

    for (const c of page) {
      scanned++;
      const norm = normalizeContactAddressFields({
        city: c.city,
        state: c.state,
        phone: c.phone,
        neighborhood: c.neighborhood,
        street: c.street,
        zipCode: c.zipCode,
        number: c.number
      });
      if (!contactAddressChanged(c, norm)) continue;

      const beforeLabel = [c.city, c.state].filter(Boolean).join(' · ') || '(vazio)';
      const afterLabel = [norm.city, norm.state].filter(Boolean).join(' · ') || '(vazio)';
      const sampleKey = `${beforeLabel}=>${afterLabel}`;
      if (samples.length < 12 && !sampleKeys.has(sampleKey)) {
        sampleKeys.add(sampleKey);
        samples.push({ from: beforeLabel, to: afterLabel });
      }

      items.push({ id: c.id, updates: norm });
    }

    if (items.length > 0) {
      const CHUNK = 200;
      for (let i = 0; i < items.length; i += CHUNK) {
        await bulkUpdateContacts(tenantId, items.slice(i, i + CHUNK));
      }
      updated += items.length;
    }

    if (page.length < PAGE) break;
    offset += PAGE;
  }

  return { scanned, updated, samples };
}

export { applyAddressNormalizationToContact };
