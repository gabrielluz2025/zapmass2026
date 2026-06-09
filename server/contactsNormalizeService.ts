import type { Contact } from '../src/types.js';
import {
  applyAddressNormalizationToContact,
  contactAddressChanged,
  normalizeContactAddressFields
} from '../src/utils/contactAddressNormalize.js';
import { fixBrazilCoord, isCoordPlausibleForCity } from './geoCoordValidate.js';
import { ensureIbgeMunicipiosIndex } from './ibgeMunicipios.js';
import { bulkUpdateContacts, listContacts } from './repositories/contactsRepository.js';

export type NormalizeAddressesResult = {
  scanned: number;
  updated: number;
  samples: Array<{ from: string; to: string }>;
  hasMore: boolean;
  nextOffset: number;
};

const PAGE_SIZE = 5000;

export async function normalizeTenantContactAddresses(
  tenantId: string,
  opts: { offset?: number; limit?: number } = {}
): Promise<NormalizeAddressesResult> {
  const ibgeIndex = await ensureIbgeMunicipiosIndex();
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const limit = Math.min(Math.max(Number(opts.limit) || PAGE_SIZE, 1), PAGE_SIZE);

  const page = await listContacts(tenantId, { limit, offset });
  let scanned = 0;
  let updated = 0;
  const samples: Array<{ from: string; to: string }> = [];
  const sampleKeys = new Set<string>();
  const items: Array<{ id: string; updates: Partial<Contact> }> = [];

  for (const c of page) {
    scanned++;
    const norm = normalizeContactAddressFields(
      {
        city: c.city,
        state: c.state,
        phone: c.phone,
        neighborhood: c.neighborhood,
        street: c.street,
        zipCode: c.zipCode,
        number: c.number
      },
      ibgeIndex
    );
    const cityForCoord = norm.city || c.city || '';
    const stateForCoord = norm.state || c.state || '';
    const needsCoordClear =
      Number.isFinite(c.latitude) &&
      Number.isFinite(c.longitude) &&
      !isCoordPlausibleForCity(
        fixBrazilCoord(c.latitude!, c.longitude!).lat,
        fixBrazilCoord(c.latitude!, c.longitude!).lng,
        cityForCoord,
        stateForCoord
      );

    if (!contactAddressChanged(c, norm) && !needsCoordClear) continue;

    const updates: Partial<Contact> = { ...norm };
    if (needsCoordClear) {
      updates.latitude = undefined;
      updates.longitude = undefined;
      updates.geocodedAt = undefined;
    }

    const fmt = (city?: string, state?: string, nb?: string) => {
      const parts = [nb, city, state].filter(Boolean);
      return parts.length > 0 ? parts.join(' · ') : '(vazio)';
    };
    const beforeLabel = fmt(c.city, c.state, c.neighborhood);
    const afterLabel = fmt(norm.city, norm.state, norm.neighborhood);
    const sampleKey = `${beforeLabel}=>${afterLabel}`;
    if (samples.length < 12 && !sampleKeys.has(sampleKey)) {
      sampleKeys.add(sampleKey);
      samples.push({ from: beforeLabel, to: afterLabel });
    }

    items.push({ id: c.id, updates });
  }

  if (items.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < items.length; i += CHUNK) {
      await bulkUpdateContacts(tenantId, items.slice(i, i + CHUNK));
    }
    updated = items.length;
  }

  const hasMore = page.length >= limit;
  return {
    scanned,
    updated,
    samples,
    hasMore,
    nextOffset: offset + page.length
  };
}

export { applyAddressNormalizationToContact };
