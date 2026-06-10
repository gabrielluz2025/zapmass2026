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

function scheduleContactGeocode(tenantId: string, contact: Contact): void {
  void geocodeSingleContactIfNeeded(tenantId, contact).catch((e) => {
    console.warn('[contacts/geocode]', contact.id, e instanceof Error ? e.message : e);
  });
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
      const created = await createContact(ctx.tenantId, body);
      scheduleContactGeocode(ctx.tenantId, created);
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
      const ids = await bulkCreateContacts(ctx.tenantId, rows);
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
    const updates = req.body as Partial<Contact>;
    const updated = await updateContact(ctx.tenantId, id, updates);
    if (!updated) {
      return res.status(404).json({ ok: false, error: 'Contato não encontrado.' });
    }
    const addressTouched =
      'street' in updates ||
      'number' in updates ||
      'city' in updates ||
      'state' in updates ||
      'neighborhood' in updates ||
      'zipCode' in updates;
    if (addressTouched) scheduleContactGeocode(ctx.tenantId, updated);
    return res.json({ ok: true, contact: updated });
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
