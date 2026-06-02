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
  createContactList,
  deleteAllContactLists,
  deleteContactList,
  listContactLists,
  updateContactList
} from './repositories/contactListsRepository.js';

export function registerContactsDataRoutes(app: Express): void {
  if (!vpsDataEnabled() || !getZapmassPool()) return;

  app.get('/api/contacts', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const limit = Math.min(Number(req.query.limit) || 5000, 10_000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const contacts = await listContacts(ctx.tenantId, { limit, offset });
    const total = await countContacts(ctx.tenantId);
    return res.json({
      ok: true,
      contacts,
      total,
      hasMore: offset + contacts.length < total
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
    if (rows.length > 2000) {
      return res.status(400).json({ ok: false, error: 'Máximo 2000 contatos por lote.' });
    }
    try {
      const ids = await bulkCreateContacts(ctx.tenantId, rows);
      return res.json({ ok: true, ids, count: ids.length });
    } catch (e) {
      console.error('[api/contacts/bulk]', e);
      return res.status(400).json({ ok: false, error: 'Falha no lote de contatos.' });
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
    return res.json({ ok: true, contact: updated });
  });

  app.post('/api/contacts/bulk-update', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const items = (req.body as { items?: Array<{ id: string; updates: Partial<Contact> }> })?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'Envie { items: [...] }.' });
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
    const updated = await updateContactList(ctx.tenantId, id, req.body as Partial<ContactList>);
    if (!updated) {
      return res.status(404).json({ ok: false, error: 'Lista não encontrada.' });
    }
    return res.json({ ok: true, list: updated });
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
