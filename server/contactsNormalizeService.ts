import type { Contact } from '../src/types.js';
import {
  buildNeighborhoodToCityMap,
  contactAddressChanged,
  normalizeContactAddressFields
} from '../src/utils/contactAddressNormalize.js';
import { fixBrazilCoord, isCoordPlausibleForCity } from './geoCoordValidate.js';
import { ensureIbgeMunicipiosIndex } from './ibgeMunicipios.js';
import { invalidateLeadsGeoSummaryCache } from './leadsGeoService.js';
import { invalidateCrmContactIndexCache } from './crmContactIndexCache.js';
import { bulkUpdateContacts, listContacts } from './repositories/contactsRepository.js';

export type NormalizeAddressesResult = {
  scanned: number;
  updated: number;
  samples: Array<{ from: string; to: string }>;
  hasMore: boolean;
  nextOffset: number;
};

const PAGE_SIZE = 5000;
const VIA_CEP_DELAY_MS = 280;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function viaCepLookup(cep: string): Promise<{
  city?: string;
  state?: string;
  street?: string;
  neighborhood?: string;
} | null> {
  try {
    const digits = cep.replace(/\D/g, '');
    if (digits.length !== 8) return null;
    const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      signal: AbortSignal.timeout(4000)
    });
    if (!r.ok) return null;
    const data = (await r.json()) as {
      localidade?: string;
      uf?: string;
      erro?: boolean;
      logradouro?: string;
      bairro?: string;
    };
    if (data.erro) return null;
    return {
      city: String(data.localidade || '').trim() || undefined,
      state: String(data.uf || '').trim().toUpperCase().slice(0, 2) || undefined,
      street: String(data.logradouro || '').trim() || undefined,
      neighborhood: String(data.bairro || '').trim() || undefined
    };
  } catch {
    return null;
  }
}

function mergeViaCep(
  norm: ReturnType<typeof normalizeContactAddressFields>,
  via: NonNullable<Awaited<ReturnType<typeof viaCepLookup>>>
): ReturnType<typeof normalizeContactAddressFields> {
  const out = { ...norm };
  if (via.city) out.city = via.city;
  if (via.state) out.state = via.state;
  if (via.street && (!out.street || out.street.length < via.street.length)) {
    out.street = via.street;
  }
  if (via.neighborhood && !out.neighborhood) out.neighborhood = via.neighborhood;
  return out;
}

export async function normalizeTenantContactAddresses(
  tenantId: string,
  opts: { offset?: number; limit?: number } = {}
): Promise<NormalizeAddressesResult> {
  const ibgeIndex = await ensureIbgeMunicipiosIndex();
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const limit = Math.min(Math.max(Number(opts.limit) || PAGE_SIZE, 1), PAGE_SIZE);

  const page = await listContacts(tenantId, { limit, offset });
  const nbToCityMap = buildNeighborhoodToCityMap(page, ibgeIndex);

  let scanned = 0;
  let updated = 0;
  const samples: Array<{ from: string; to: string }> = [];
  const sampleKeys = new Set<string>();
  const items: Array<{ id: string; updates: Partial<Contact> }> = [];
  let viaCepCount = 0;

  for (const c of page) {
    scanned++;
    let norm = normalizeContactAddressFields(
      {
        city: c.city,
        state: c.state,
        phone: c.phone,
        neighborhood: c.neighborhood,
        street: c.street,
        zipCode: c.zipCode,
        number: c.number
      },
      ibgeIndex,
      nbToCityMap
    );

    const cepDigits = (c.zipCode || norm.zipCode || '').replace(/\D/g, '');
    if (cepDigits.length === 8) {
      if (viaCepCount > 0) await sleep(VIA_CEP_DELAY_MS);
      viaCepCount++;
      const via = await viaCepLookup(cepDigits);
      if (via) norm = mergeViaCep(norm, via);
    }

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

    const addressChanged = contactAddressChanged(c, norm);
    if (!addressChanged && !needsCoordClear) continue;

    const updates: Partial<Contact> = {
      ...norm,
      addressNormalizedAt: new Date().toISOString()
    };
    if (addressChanged || needsCoordClear) {
      updates.latitude = undefined;
      updates.longitude = undefined;
      updates.geocodedAt = undefined;
      updates.geocodePrecision = undefined;
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
    invalidateLeadsGeoSummaryCache(tenantId);
    invalidateCrmContactIndexCache(tenantId);
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

export { applyAddressNormalizationToContact } from '../src/utils/contactAddressNormalize.js';
