import axios, { type AxiosInstance } from 'axios';
import type { Contact } from '../src/types.js';
import { isPlausibleBrazilWhatsAppPhone, normalizeBRPhone } from '../src/utils/brPhoneNormalize.js';
import {
  buildOutboundPhoneVariants,
  parseWhatsAppNumberCheckRows,
  pickWhatsAppCheckResult,
  type WhatsAppNumberCheckRow,
} from './evolutionOutboundPhone.js';
import { evolutionConfig } from './evolutionConfig.js';
import * as evolutionService from './evolutionService.js';
import { invalidateCrmContactIndexCache } from './crmContactIndexCache.js';
import { bulkUpdateContacts, invalidateContactsCountCache, listContacts } from './repositories/contactsRepository.js';

export type WhatsAppValidateSampleResult = 'found' | 'corrected' | 'missing' | 'invalid_format' | 'uncertain';

export type ValidateContactsWhatsAppResult = {
  scanned: number;
  onWhatsApp: number;
  phoneCorrected: number;
  notOnWhatsApp: number;
  invalidFormat: number;
  uncertain: number;
  samples: Array<{
    name: string;
    before: string;
    after?: string;
    result: WhatsAppValidateSampleResult;
  }>;
  hasMore: boolean;
  nextOffset: number;
  applied: boolean;
};

const PAGE_SIZE = 50;
const WA_BATCH_SIZE = 25;
const WA_DELAY_MS = 180;

let apiClient: AxiosInstance | null = null;

function getEvolutionApi(): AxiosInstance {
  if (!apiClient) {
    apiClient = axios.create({
      baseURL: evolutionConfig.apiUrl,
      timeout: evolutionConfig.timeout,
      headers: { apikey: evolutionConfig.apiKey },
    });
  }
  return apiClient;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CheckOutcome = {
  exists: boolean;
  canonicalNumber?: string;
  lidOnly?: boolean;
  emptyResponse?: boolean;
  checkFailed?: boolean;
};

async function batchCheckWhatsAppNumbers(
  instanceName: string,
  numbers: string[]
): Promise<Map<string, CheckOutcome>> {
  const out = new Map<string, CheckOutcome>();
  if (numbers.length === 0) return out;

  try {
    const response = await getEvolutionApi().post(`/chat/whatsappNumbers/${instanceName}`, {
      numbers,
    });
    const rows = parseWhatsAppNumberCheckRows(response.data);
    for (const n of numbers) {
      out.set(n, pickWhatsAppCheckResult(rows as WhatsAppNumberCheckRow[], n));
    }
  } catch {
    for (const n of numbers) {
      out.set(n, { exists: false, checkFailed: true });
    }
  }
  return out;
}

function resolveFromVariantChecks(
  phone: string,
  checks: Map<string, CheckOutcome>
): { result: WhatsAppValidateSampleResult; canonical?: string } {
  const normalized = normalizeBRPhone(phone);
  if (!normalized || !isPlausibleBrazilWhatsAppPhone(normalized)) {
    return { result: 'invalid_format' };
  }

  const variants = buildOutboundPhoneVariants(normalized);
  if (variants.length === 0) return { result: 'invalid_format' };

  let sawUncertain = false;
  let sawDefiniteMissing = false;

  for (const variant of variants) {
    const check = checks.get(variant);
    if (!check) continue;
    if (check.checkFailed) {
      sawUncertain = true;
      continue;
    }
    if (check.exists && check.canonicalNumber) {
      const canonical = normalizeBRPhone(check.canonicalNumber) || check.canonicalNumber;
      if (canonical === normalized) return { result: 'found', canonical };
      return { result: 'corrected', canonical };
    }
    sawDefiniteMissing = true;
  }

  if (sawUncertain && !sawDefiniteMissing) return { result: 'uncertain' };
  if (sawDefiniteMissing) return { result: 'missing' };
  return { result: 'uncertain' };
}

async function pickOpenConnectionForTenant(
  tenantId: string,
  preferredConnectionId?: string
): Promise<string | null> {
  const tenantConns = evolutionService.getConnectionsForTenant(tenantId);
  if (tenantConns.length === 0) return null;

  const ordered = preferredConnectionId
    ? [
        ...tenantConns.filter((c) => c.id === preferredConnectionId),
        ...tenantConns.filter((c) => c.id !== preferredConnectionId),
      ]
    : tenantConns;

  for (const conn of ordered) {
    const state = await evolutionService.getConnectionStatePublic(conn.id);
    if (state.isOpen) return conn.id;
  }
  return ordered[0]?.id ?? null;
}

/** Valida telefones na Evolution (whatsappNumbers) e corrige o cadastro quando possível. */
export async function validateTenantContactsWhatsApp(
  tenantId: string,
  opts: {
    offset?: number;
    limit?: number;
    dryRun?: boolean;
    connectionId?: string;
    markMissingInvalid?: boolean;
  } = {}
): Promise<ValidateContactsWhatsAppResult> {
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const limit = Math.min(Math.max(Number(opts.limit) || PAGE_SIZE, 1), PAGE_SIZE);
  const dryRun = opts.dryRun !== false;
  const markMissingInvalid = opts.markMissingInvalid !== false;

  const connectionId = await pickOpenConnectionForTenant(tenantId, opts.connectionId);
  if (!connectionId) {
    throw new Error('Nenhum chip WhatsApp conectado. Conecte um canal antes de validar.');
  }

  const page = await listContacts(tenantId, { limit, offset });
  const allVariants = new Set<string>();

  for (const c of page) {
    const normalized = normalizeBRPhone(c.phone || '');
    const variants = isPlausibleBrazilWhatsAppPhone(normalized)
      ? buildOutboundPhoneVariants(normalized)
      : [];
    for (const v of variants) allVariants.add(v);
  }

  const checks = new Map<string, CheckOutcome>();
  const variantList = [...allVariants];
  for (let i = 0; i < variantList.length; i += WA_BATCH_SIZE) {
    const chunk = variantList.slice(i, i + WA_BATCH_SIZE);
    const partial = await batchCheckWhatsAppNumbers(connectionId, chunk);
    for (const [k, v] of partial) checks.set(k, v);
    if (i + WA_BATCH_SIZE < variantList.length) await sleep(WA_DELAY_MS);
  }

  let onWhatsApp = 0;
  let phoneCorrected = 0;
  let notOnWhatsApp = 0;
  let invalidFormat = 0;
  let uncertain = 0;
  const samples: ValidateContactsWhatsAppResult['samples'] = [];
  const items: Array<{ id: string; updates: Partial<Contact> }> = [];

  for (const c of page) {
    const before = normalizeBRPhone(c.phone || '') || String(c.phone || '').trim();
    const resolved = resolveFromVariantChecks(c.phone || '', checks);

    if (resolved.result === 'found') onWhatsApp++;
    else if (resolved.result === 'corrected') {
      onWhatsApp++;
      phoneCorrected++;
    } else if (resolved.result === 'missing') notOnWhatsApp++;
    else if (resolved.result === 'invalid_format') invalidFormat++;
    else uncertain++;

    if (samples.length < 16) {
      samples.push({
        name: c.name || 'Sem nome',
        before,
        after: resolved.canonical,
        result: resolved.result,
      });
    }

    if (dryRun) continue;

    const updates: Partial<Contact> = {};
    if (resolved.result === 'found' || resolved.result === 'corrected') {
      if (resolved.canonical && resolved.canonical !== before) {
        updates.phone = resolved.canonical;
      }
      if (c.status === 'INVALID') updates.status = 'VALID';
    } else if (resolved.result === 'missing' && markMissingInvalid) {
      updates.status = 'INVALID';
    } else if (resolved.result === 'invalid_format') {
      updates.status = 'INVALID';
    }

    if (Object.keys(updates).length > 0) {
      items.push({ id: c.id, updates });
    }
  }

  if (!dryRun && items.length > 0) {
    const CHUNK = 100;
    for (let i = 0; i < items.length; i += CHUNK) {
      await bulkUpdateContacts(tenantId, items.slice(i, i + CHUNK));
    }
    invalidateCrmContactIndexCache(tenantId);
    invalidateContactsCountCache(tenantId);
  }

  const hasMore = page.length >= limit;
  return {
    scanned: page.length,
    onWhatsApp,
    phoneCorrected,
    notOnWhatsApp,
    invalidFormat,
    uncertain,
    samples,
    hasMore,
    nextOffset: offset + page.length,
    applied: !dryRun && items.length > 0,
  };
}
