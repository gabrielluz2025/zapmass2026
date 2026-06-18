import type { Express, Request, Response } from 'express';
import type { Contact, ContactList } from '../src/types.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { requireTenant } from './httpTenant.js';
import {
  bulkCreateContacts,
  bulkUpdateContacts,
  countContacts,
  createContact,
  deleteAllContacts,
  deleteContact,
  listContacts,
  updateContact
} from './repositories/contactsRepository.js';
import {
  appendContactIdsToContactList as appendIdsToContactListRepo,
  createContactList,
  deleteAllContactLists,
  deleteContactList,
  listContactLists,
  updateContactList
} from './repositories/contactListsRepository.js';
import {
  fetchAndPersistContactProfilePicture,
  fetchAndPersistContactProfilePicturesBatch
} from './contactProfilePicture.js';
import * as evolutionService from './evolutionService.js';
import { normalizeTenantContactAddresses } from './contactsNormalizeService.js';
import { geocodeSingleContactIfNeeded } from './leadsGeoService.js';
import { normalizeContactAddressFields } from '../src/utils/contactAddressNormalize.js';
import { ensureIbgeMunicipiosIndex, getIbgeMunicipiosIndex } from './ibgeMunicipios.js';
import { resolveCitySearchLabel } from '../src/utils/ibgeCityLookup.js';
import { runAddressNormalizationBatch } from './addressNormalizationJob.js';

/** Consulta ViaCEP e retorna endereço canônico completo (cidade, estado, rua, bairro). */
async function lookupViaCep(
  cep: string,
  currentCity: string,
  currentState: string
): Promise<{ city?: string; state?: string; street?: string; neighborhood?: string } | null> {
  try {
    const digits = cep.replace(/\D/g, '');
    if (digits.length !== 8) return null;
    const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      signal: AbortSignal.timeout(3000)
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
    const viaCepCity = String(data.localidade || '').trim();
    const viaCepState = String(data.uf || '').trim().toUpperCase().slice(0, 2);
    const viaCepStreet = String(data.logradouro || '').trim();
    const viaCepNb = String(data.bairro || '').trim();
    const patch: { city?: string; state?: string; street?: string; neighborhood?: string } = {};
    if (viaCepCity && viaCepCity.toLowerCase() !== (currentCity || '').toLowerCase()) {
      patch.city = viaCepCity;
    }
    if (viaCepState && viaCepState !== (currentState || '').toUpperCase()) {
      patch.state = viaCepState;
    }
    if (viaCepStreet) patch.street = viaCepStreet;
    if (viaCepNb) patch.neighborhood = viaCepNb;
    return Object.keys(patch).length > 0 ? patch : null;
  } catch {
    return null;
  }
}

/** Aplica normalização IBGE + ViaCEP antes de salvar um contato. */
async function normalizeAddressBeforeSave(contact: Partial<Contact>): Promise<Partial<Contact>> {
  const hasAddress =
    contact.city || contact.state || contact.neighborhood || contact.street || contact.zipCode;
  if (!hasAddress) return contact;

  const ibgeIndex = await ensureIbgeMunicipiosIndex().catch(() => getIbgeMunicipiosIndex());
  const norm = normalizeContactAddressFields(
    {
      city: contact.city,
      state: contact.state,
      phone: contact.phone,
      neighborhood: contact.neighborhood,
      street: contact.street,
      zipCode: contact.zipCode,
      number: contact.number
    },
    ibgeIndex
  );

  let mergedCity = norm.city || contact.city;
  let mergedState = norm.state || contact.state;

  let mergedStreet = norm.street || contact.street;
  let mergedNeighborhood = norm.neighborhood || contact.neighborhood;

  const cepDigits = (contact.zipCode || '').replace(/\D/g, '');
  if (cepDigits.length === 8) {
    const viaCep = await lookupViaCep(cepDigits, mergedCity || '', mergedState || '');
    if (viaCep?.city) mergedCity = viaCep.city;
    if (viaCep?.state) mergedState = viaCep.state;
    // Aplica rua canônica do ViaCEP quando a atual está vazia ou parece ser o mesmo logradouro com erros
    if (viaCep?.street) {
      const existNorm = (mergedStreet || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
      const cepNorm = viaCep.street.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
      if (!existNorm || cepNorm.startsWith(existNorm.slice(0, 8)) || existNorm.startsWith(cepNorm.slice(0, 8))) {
        mergedStreet = viaCep.street;
      }
    }
    // Preenche bairro se estiver vazio
    if (viaCep?.neighborhood && !mergedNeighborhood) {
      mergedNeighborhood = viaCep.neighborhood;
    }
  }

  return {
    ...contact,
    ...norm,
    city: mergedCity,
    state: mergedState,
    street: mergedStreet,
    neighborhood: mergedNeighborhood,
    addressNormalizedAt: new Date().toISOString()
  };
}

export function registerContactsDataRoutes(app: Express): void {
  if (!vpsDataEnabled() || !getZapmassPool()) return;

  app.get('/api/contacts', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const limit = Math.min(Number(req.query.limit) || 10_000, 10_000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const skipCount = String(req.query.skipCount || '') === '1';
    const contacts = await listContacts(ctx.tenantId, { limit, offset });
    const total = skipCount
      ? offset + contacts.length + (contacts.length >= limit ? limit : 0)
      : await countContacts(ctx.tenantId);
    const hasMore = skipCount
      ? contacts.length >= limit
      : offset + contacts.length < total;
    return res.json({
      ok: true,
      contacts,
      total: skipCount ? undefined : total,
      hasMore
    });
  });

  app.get('/api/contacts/count', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const total = await countContacts(ctx.tenantId);
    return res.json({ ok: true, total });
  });

  app.post('/api/contacts', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = req.body as Partial<Contact>;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ ok: false, error: 'Corpo inválido.' });
    }
    try {
      const normalized = await normalizeAddressBeforeSave(body);
      let created = await createContact(ctx.tenantId, normalized);
      try {
        created = await geocodeSingleContactIfNeeded(ctx.tenantId, created);
      } catch (geoErr) {
        console.warn('[api/contacts POST geocode]', geoErr);
      }
      return res.json({ ok: true, contact: created, id: created.id });
    } catch (e) {
      console.error('[api/contacts POST]', e);
      return res.status(400).json({ ok: false, error: 'Não foi possível criar o contato.' });
    }
  });

  app.post('/api/contacts/bulk', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const rows = (req.body as { contacts?: Partial<Contact>[] })?.contacts;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ ok: false, error: 'Envie { contacts: [...] }.' });
    }
    if (rows.length > 500) {
      return res.status(400).json({ ok: false, error: 'Máximo 500 contatos por lote.' });
    }
    try {
      // Aplica normalização síncrona (IBGE + regras) sem ViaCEP para não atrasar o import.
      // ViaCEP é aplicado depois pelo job em background.
      const ibgeIndex = await ensureIbgeMunicipiosIndex().catch(() => getIbgeMunicipiosIndex());
      const normalized = rows.map((c) => {
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
        return { ...c, ...norm };
      });
      const ids = await bulkCreateContacts(ctx.tenantId, normalized);
      // Dispara normalização ViaCEP em background para os novos contatos
      runAddressNormalizationBatch(ctx.tenantId, 100).catch((e) => {
        console.warn('[api/contacts/bulk] background normalize error:', e);
      });
      return res.json({ ok: true, ids, count: ids.length });
    } catch (e) {
      console.error('[api/contacts/bulk]', e);
      return res.status(400).json({ ok: false, error: 'Falha no lote de contatos.' });
    }
  });

  app.post('/api/contacts/:id/profile-picture', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const id = String(req.params.id || '').trim();
    const body = (req.body || {}) as { connectionId?: string; force?: boolean };
    const connId = evolutionService.pickOpenConnectionForTenant(ctx.tenantId, body.connectionId);
    if (!connId) {
      return res.status(409).json({
        ok: false,
        error: 'Nenhum chip WhatsApp conectado. Conecte um canal em Conexões.'
      });
    }
    try {
      const r = await fetchAndPersistContactProfilePicture(ctx.tenantId, id, {
        connectionId: connId,
        force: body.force === true
      });
      return res.json({ ok: true, profilePicUrl: r.profilePicUrl, contact: r.contact });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('não encontrado')) {
        return res.status(404).json({ ok: false, error: message });
      }
      console.error('[api/contacts profile-picture]', message);
      return res.status(500).json({ ok: false, error: 'Não foi possível buscar a foto.' });
    }
  });

  app.post('/api/contacts/profile-pictures-batch', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = (req.body || {}) as { ids?: string[]; connectionId?: string };
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (ids.length === 0) {
      return res.status(400).json({ ok: false, error: 'Envie { ids: [...] }.' });
    }
    const connId = evolutionService.pickOpenConnectionForTenant(ctx.tenantId, body.connectionId);
    if (!connId) {
      return res.status(409).json({
        ok: false,
        error: 'Nenhum chip WhatsApp conectado.'
      });
    }
    try {
      const results = await fetchAndPersistContactProfilePicturesBatch(ctx.tenantId, ids, {
        connectionId: connId
      });
      return res.json({ ok: true, results });
    } catch (e) {
      console.error('[api/contacts profile-pictures-batch]', e);
      return res.status(500).json({ ok: false, error: 'Falha ao buscar fotos em lote.' });
    }
  });

  app.patch('/api/contacts/:id', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const id = String(req.params.id || '').trim();
    const rawUpdates = req.body as Partial<Contact>;
    const updates = await normalizeAddressBeforeSave(rawUpdates);
    let updated = await updateContact(ctx.tenantId, id, updates);
    if (!updated) {
      return res.status(404).json({ ok: false, error: 'Contato não encontrado.' });
    }
    try {
      updated = await geocodeSingleContactIfNeeded(ctx.tenantId, updated);
    } catch (geoErr) {
      console.warn('[api/contacts PATCH geocode]', geoErr);
    }
    return res.json({ ok: true, contact: updated });
  });

  app.post('/api/contacts/normalize-batch', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = (req.body || {}) as { batchSize?: number };
    const batchSize = Math.min(Math.max(Number(body.batchSize) || 200, 10), 500);
    res.json({ ok: true, message: 'Normalização em lote iniciada em background.' });
    runAddressNormalizationBatch(ctx.tenantId, batchSize).catch((e) => {
      console.error('[normalize-batch background]', e);
    });
  });

  app.post('/api/contacts/normalize-addresses', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = (req.body || {}) as { offset?: number; limit?: number };
    const offset = Math.max(Number(body.offset) || 0, 0);
    const limit = Math.min(Math.max(Number(body.limit) || 5000, 1), 5000);
    try {
      const result = await normalizeTenantContactAddresses(ctx.tenantId, { offset, limit });
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error('[api/contacts/normalize-addresses]', e);
      return res.status(500).json({ ok: false, error: 'Falha ao padronizar endereços.' });
    }
  });

  app.post('/api/contacts/bulk-update', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const items = (req.body as { items?: Array<{ id: string; updates: Partial<Contact> }> })?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'Envie { items: [...] }.' });
    }
    if (items.length > 500) {
      return res.status(400).json({ ok: false, error: 'Máximo 500 atualizações por lote.' });
    }
    await bulkUpdateContacts(ctx.tenantId, items);
    return res.json({ ok: true, count: items.length });
  });

  app.delete('/api/contacts/:id', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const id = String(req.params.id || '').trim();
    const ok = await deleteContact(ctx.tenantId, id);
    if (!ok) return res.status(404).json({ ok: false, error: 'Contato não encontrado.' });
    return res.json({ ok: true });
  });

  app.get('/api/contact-lists', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const lists = await listContactLists(ctx.tenantId);
    return res.json({ ok: true, lists });
  });

  app.post('/api/contact-lists', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = req.body as Partial<ContactList>;
    try {
      const created = await createContactList(ctx.tenantId, body);
      return res.json({ ok: true, list: created, id: created.id });
    } catch (e) {
      console.error('[api/contact-lists POST]', e);
      return res.status(400).json({ ok: false, error: 'Não foi possível criar a lista.' });
    }
  });

  app.patch('/api/contact-lists/:id', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const id = String(req.params.id || '').trim();
    try {
      const updated = await updateContactList(ctx.tenantId, id, req.body as Partial<ContactList>);
      if (!updated) {
        return res.status(404).json({ ok: false, error: 'Lista não encontrada.' });
      }
      return res.json({ ok: true, list: updated });
    } catch (e) {
      console.error('[api/contact-lists PATCH]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível atualizar a lista.' });
    }
  });

  app.post('/api/contact-lists/:id/append', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const id = String(req.params.id || '').trim();
    const body = (req.body || {}) as { contactIds?: string[]; notesLine?: string };
    const contactIds = Array.isArray(body.contactIds) ? body.contactIds.map(String).filter(Boolean) : [];
    if (contactIds.length === 0 && !body.notesLine) {
      return res.status(400).json({ ok: false, error: 'Nenhum contato informado.' });
    }
    if (contactIds.length > 5000) {
      return res.status(400).json({
        ok: false,
        error: 'Máximo 5000 contatos por lote. Envie em partes menores.'
      });
    }
    try {
      const result = await appendIdsToContactListRepo(ctx.tenantId, id, contactIds, {
        notesLine: body.notesLine
      });
      if (!result) {
        return res.status(404).json({ ok: false, error: 'Lista não encontrada.' });
      }
      return res.json({ ok: true, list: result.list, added: result.added });
    } catch (e) {
      console.error('[api/contact-lists append]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível atualizar a lista.' });
    }
  });

  app.delete('/api/contact-lists/:id', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const ok = await deleteContactList(ctx.tenantId, String(req.params.id || '').trim());
    if (!ok) return res.status(404).json({ ok: false, error: 'Lista não encontrada.' });
    return res.json({ ok: true });
  });

  /** Limpeza total (configurações / reset tenant) — só dono. */
  app.delete('/api/tenant/contacts-data', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    if (ctx.principal.role !== 'owner' || ctx.principal.authUid !== ctx.tenantId) {
      return res.status(403).json({ ok: false, error: 'Apenas o dono da conta pode apagar todos os dados.' });
    }
    const contacts = await deleteAllContacts(ctx.tenantId);
    const lists = await deleteAllContactLists(ctx.tenantId);
    return res.json({ ok: true, contacts, contactLists: lists });
  });
}
