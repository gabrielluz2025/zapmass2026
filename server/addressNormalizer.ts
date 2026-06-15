/**
 * addressNormalizer.ts
 *
 * Normalização inteligente de endereços de contatos.
 *
 * Pipeline por contato:
 *  1. Se tem CEP válido → BrasilAPI retorna rua/bairro/cidade/estado canônicos
 *     → grava os campos corrigidos no contato (não só lat/lng)
 *  2. Normalização textual independente de CEP:
 *     - Expande abreviações (R. → Rua, Av. → Avenida, etc.)
 *     - Normaliza estado (Santa Catarina → SC)
 *     - TitleCase + reparo de mojibake em cidade/rua/bairro
 *  3. Reseta geocodedAt quando o endereço mudou significativamente para forçar
 *     re-geocodificação com o endereço correto
 */

import type { Contact } from '../src/types.js';
import { updateContact, bulkUpdateContacts } from './repositories/contactsRepository.js';
import { listContacts } from './repositories/contactsRepository.js';
import { invalidateLeadsGeoSummaryCache } from './leadsGeoService.js';

// ─── Tabela de estados BR ────────────────────────────────────────────────────

const UF_BY_NAME: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amapá: 'AP', amazonas: 'AM',
  bahia: 'BA', ceara: 'CE', ceará: 'CE',
  'distrito federal': 'DF', 'espirito santo': 'ES', 'espírito santo': 'ES',
  goias: 'GO', goiás: 'GO', maranhao: 'MA', maranhão: 'MA',
  'mato grosso': 'MT', 'mato grosso do sul': 'MS',
  'minas gerais': 'MG', para: 'PA', pará: 'PA',
  paraiba: 'PB', paraíba: 'PB', parana: 'PR', paraná: 'PR',
  pernambuco: 'PE', piaui: 'PI', piauí: 'PI',
  'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
  'rio grande do sul': 'RS', rondonia: 'RO', rondônia: 'RO',
  roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', 'são paulo': 'SP',
  sergipe: 'SE', tocantins: 'TO',
};

const VALID_UF = new Set([
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA',
  'MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN',
  'RO','RR','RS','SC','SE','SP','TO'
]);

/** "Santa Catarina" → "SC", "sc" → "SC", "SC" → "SC" */
function normalizeState(raw: string): string {
  const t = String(raw || '').trim();
  if (!t) return t;
  const up = t.toUpperCase();
  if (VALID_UF.has(up)) return up;
  const lo = t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return UF_BY_NAME[lo] || t;
}

// ─── Abreviações de logradouro ───────────────────────────────────────────────

const STREET_ABBR: [RegExp, string][] = [
  [/^\bR\.\s+/i, 'Rua '],
  [/^\bRua\.\s+/i, 'Rua '],
  [/^\bAv\.\s+/i, 'Avenida '],
  [/^\bAv\s+/i, 'Avenida '],
  [/^\bAl\.\s+/i, 'Alameda '],
  [/^\bTrav\.\s+/i, 'Travessa '],
  [/^\bEstr\.\s+/i, 'Estrada '],
  [/^\bRod\.\s+/i, 'Rodovia '],
  [/^\bPç\.\s+/i, 'Praça '],
  [/^\bPça\.\s+/i, 'Praça '],
  [/^\bPça\s+/i, 'Praça '],
];

function expandStreetAbbr(s: string): string {
  const t = s.trim();
  for (const [re, replacement] of STREET_ABBR) {
    if (re.test(t)) return t.replace(re, replacement);
  }
  return t;
}

// ─── TitleCase simples ───────────────────────────────────────────────────────

const SMALL_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'na', 'no']);

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i === 0 || !SMALL_WORDS.has(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

// ─── CEP + BrasilAPI ─────────────────────────────────────────────────────────

interface CepCanonical {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
}

const cepCache = new Map<string, CepCanonical | null>();

async function fetchCepCanonical(rawCep: string): Promise<CepCanonical | null> {
  const cep = String(rawCep || '').replace(/\D/g, '');
  if (cep.length !== 8) return null;
  if (cepCache.has(cep)) return cepCache.get(cep) ?? null;

  // Tenta ViaCEP primeiro (retorna dados sem lat/lng mas muito confiável)
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (r.ok) {
      const j = (await r.json()) as {
        erro?: boolean;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };
      if (!j.erro && j.localidade) {
        const hit: CepCanonical = {
          street: String(j.logradouro || '').trim(),
          neighborhood: String(j.bairro || '').trim(),
          city: String(j.localidade || '').trim(),
          state: String(j.uf || '').trim().toUpperCase(),
        };
        cepCache.set(cep, hit);
        return hit;
      }
    }
  } catch { /* fallthrough */ }

  // Fallback: BrasilAPI
  try {
    const r = await fetch(`https://brasilapi.com.br/api/v2/cep/${cep}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (r.ok) {
      const j = (await r.json()) as {
        street?: string;
        neighborhood?: string;
        city?: string;
        state?: string;
      };
      if (j.city) {
        const hit: CepCanonical = {
          street: String(j.street || '').trim(),
          neighborhood: String(j.neighborhood || '').trim(),
          city: String(j.city || '').trim(),
          state: String(j.state || '').trim().toUpperCase(),
        };
        cepCache.set(cep, hit);
        return hit;
      }
    }
  } catch { /* sem resultado */ }

  cepCache.set(cep, null);
  return null;
}

// ─── Comparação de campos ─────────────────────────────────────────────────────

function normForCompare(s: string): string {
  return String(s || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function fieldChanged(before: string, after: string): boolean {
  if (!after) return false; // não sobrescreve com vazio
  return normForCompare(before) !== normForCompare(after);
}

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface AddressNormDiff {
  contactId: string;
  name: string;
  field: string;
  before: string;
  after: string;
  source: 'cep_viacep' | 'cep_brasilapi' | 'abbreviation' | 'state_name' | 'titlecase';
}

export interface NormalizeAddressesResult {
  processed: number;
  changed: number;
  unchanged: number;
  failed: number;
  diffs: AddressNormDiff[];
}

// ─── Normalização de um contato ───────────────────────────────────────────────

async function normalizeOneContact(
  c: Contact
): Promise<{ updates: Partial<Contact>; diffs: AddressNormDiff[] } | null> {
  const updates: Partial<Contact> = {};
  const diffs: AddressNormDiff[] = [];

  const push = (field: string, before: string, after: string, source: AddressNormDiff['source']) => {
    if (!after || !fieldChanged(before, after)) return;
    diffs.push({ contactId: c.id, name: c.name, field, before, after, source });
    (updates as Record<string, string>)[field] = after;
  };

  const cep = String(c.zipCode || '').replace(/\D/g, '');

  // 1. CEP → dados canônicos dos Correios
  if (cep.length === 8) {
    const canonical = await fetchCepCanonical(cep);
    if (canonical) {
      const src = 'cep_viacep';
      if (canonical.city) push('city', c.city || '', canonical.city, src);
      if (canonical.state) push('state', c.state || '', canonical.state, src);
      if (canonical.neighborhood) push('neighborhood', c.neighborhood || '', canonical.neighborhood, src);
      // Rua: só sobrescreve se o contato não tem rua ou a rua é muito diferente
      if (canonical.street) {
        const existingNorm = normForCompare(c.street || '');
        const cepNorm = normForCompare(canonical.street);
        // Aplica se o contato não tem rua, ou se a diferença é grande (>3 chars de Levenshtein simplificado)
        if (!existingNorm || (existingNorm.length > 0 && !existingNorm.includes(cepNorm.slice(0, 8)))) {
          push('street', c.street || '', canonical.street, src);
        }
      }
    }
  }

  // 2. Normaliza estado (nome completo → sigla)
  const currentState = String((updates.state as string) || c.state || '').trim();
  if (currentState) {
    const normalized = normalizeState(currentState);
    if (normalized !== currentState) push('state', currentState, normalized, 'state_name');
  }

  // 3. Expande abreviações na rua
  const currentStreet = String((updates.street as string) || c.street || '').trim();
  if (currentStreet) {
    const expanded = expandStreetAbbr(currentStreet);
    if (expanded !== currentStreet) push('street', currentStreet, expanded, 'abbreviation');
  }

  // 4. TitleCase em cidade e bairro
  const currentCity = String((updates.city as string) || c.city || '').trim();
  if (currentCity && currentCity === currentCity.toUpperCase()) {
    push('city', currentCity, titleCase(currentCity), 'titlecase');
  }
  const currentNb = String((updates.neighborhood as string) || c.neighborhood || '').trim();
  if (currentNb && currentNb === currentNb.toUpperCase()) {
    push('neighborhood', currentNb, titleCase(currentNb), 'titlecase');
  }

  if (diffs.length === 0) return null;

  // Se cidade ou estado mudou, reseta geocodificação para re-processar com dados corretos
  const addressFieldsChanged =
    'city' in updates || 'state' in updates || 'street' in updates || 'neighborhood' in updates;
  if (addressFieldsChanged) {
    updates.latitude = undefined;
    updates.longitude = undefined;
    updates.geocodedAt = undefined;
    updates.geocodePrecision = undefined;
  }

  return { updates, diffs };
}

// ─── Função principal ─────────────────────────────────────────────────────────

export async function normalizeContactAddresses(
  tenantId: string,
  opts: { max?: number; force?: boolean } = {}
): Promise<NormalizeAddressesResult> {
  const max = Math.min(opts.max ?? 300, 1000);

  const allContacts = await listContacts(tenantId);

  // Filtra contatos com algum dado de endereço
  const candidates = allContacts
    .filter((c) => c.city || c.state || c.street || c.zipCode)
    .slice(0, max);

  const result: NormalizeAddressesResult = {
    processed: 0,
    changed: 0,
    unchanged: 0,
    failed: 0,
    diffs: [],
  };

  const bulkItems: Array<{ id: string; updates: Partial<Contact> }> = [];

  for (const c of candidates) {
    result.processed++;
    try {
      const norm = await normalizeOneContact(c);
      if (!norm) {
        result.unchanged++;
        continue;
      }
      bulkItems.push({ id: c.id, updates: norm.updates });
      result.diffs.push(...norm.diffs);
      result.changed++;
    } catch {
      result.failed++;
    }
  }

  if (bulkItems.length > 0) {
    await bulkUpdateContacts(tenantId, bulkItems);
    invalidateLeadsGeoSummaryCache(tenantId);
  }

  return result;
}

// ─── Normalização de um único contato ao salvar ──────────────────────────────

/** Chamado no save/import de contato — normaliza inline sem I/O extra se possível. */
export async function normalizeContactAddressFields(
  partial: Partial<Contact>
): Promise<Partial<Contact>> {
  const patch = { ...partial };

  // Estado
  if (patch.state) {
    patch.state = normalizeState(patch.state);
  }

  // Rua: expande abreviações
  if (patch.street) {
    patch.street = expandStreetAbbr(patch.street.trim());
  }

  // CEP → enriquece campos em branco
  const cep = String(patch.zipCode || '').replace(/\D/g, '');
  if (cep.length === 8) {
    const canonical = await fetchCepCanonical(cep);
    if (canonical) {
      if (!patch.city && canonical.city) patch.city = canonical.city;
      if (!patch.state && canonical.state) patch.state = canonical.state;
      if (!patch.neighborhood && canonical.neighborhood) patch.neighborhood = canonical.neighborhood;
      if (!patch.street && canonical.street) patch.street = canonical.street;
    }
  }

  return patch;
}
