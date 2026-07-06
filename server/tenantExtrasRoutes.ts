import type { Express, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool, isZapmassPostgresConfigured } from './db/postgres.js';
import { requireTenant } from './httpTenant.js';
import { findUserById } from './auth/userRepository.js';
import { listContacts } from './repositories/contactsRepository.js';
import { listContactLists } from './repositories/contactListsRepository.js';
import { getQueueHealthMetrics } from './campaignJobsResilience.js';
import { WHATSAPP_RISK_VERSION } from '../shared/whatsappLegal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DLQ_FILE = path.join(__dirname, '../data/dead_letter_queue.json');

function clientIp(req: Request): string {
  const xf = (req.headers['x-forwarded-for'] as string) || '';
  return xf.split(',')[0]?.trim() || req.socket.remoteAddress || '';
}

export function registerTenantExtrasRoutes(app: Express): void {
  /** Saúde operacional para o painel do cliente */
  app.get('/api/tenant/ops-health', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const queue = await getQueueHealthMetrics();
    let redisPct: number | null = null;
    try {
      const deep = await fetch(`http://127.0.0.1:${process.env.PORT || 3001}/api/health/deep`);
      if (deep.ok) {
        const j = (await deep.json()) as { redis?: { memory?: { usedPct?: number } } };
        redisPct = j.redis?.memory?.usedPct ?? null;
      }
    } catch {
      /* ignore */
    }
    res.json({
      ok: true,
      queue: queue ?? { pending: 0, sending: 0, failed: 0, dead: 0, sent_last_hour: 0, backpressureActive: false },
      redisUsedPct: redisPct,
    });
  });

  /** Falhas definitivas de campanha (DLQ PG) */
  app.get('/api/tenant/campaign-failures', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    if (!isZapmassPostgresConfigured()) {
      return res.json({ ok: true, items: [] });
    }
    const pool = getZapmassPool();
    if (!pool) return res.json({ ok: true, items: [] });
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const r = await pool.query(
      `SELECT idempotency_key, campaign_id, connection_id, to_number, last_error, updated_at
         FROM zapmass.campaign_jobs
        WHERE tenant_id = $1::uuid AND status = 'dead'
        ORDER BY updated_at DESC
        LIMIT $2`,
      [ctx.tenantId, limit]
    );
    res.json({ ok: true, items: r.rows });
  });

  /** Export LGPD — JSON portável */
  app.get('/api/tenant/data-export', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    if (!vpsDataEnabled()) {
      return res.status(503).json({ ok: false, error: 'Exportação disponível apenas no modo VPS.' });
    }
    const [contacts, lists, user] = await Promise.all([
      listContacts(ctx.tenantId, { limit: 10_000, offset: 0 }),
      listContactLists(ctx.tenantId),
      findUserById(ctx.tenantId),
    ]);
    const payload = {
      exportedAt: new Date().toISOString(),
      tenantId: ctx.tenantId,
      profile: user ? { email: user.email, displayName: user.display_name } : null,
      contacts,
      contactLists: lists,
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="zapmass-export-${ctx.tenantId.slice(0, 8)}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  });

  /** Solicitação de exclusão de dados (LGPD) */
  app.post('/api/tenant/data-deletion-request', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 2000) : '';
    if (!isZapmassPostgresConfigured()) {
      return res.status(503).json({ ok: false, error: 'Registro indisponível sem PostgreSQL.' });
    }
    const pool = getZapmassPool();
    if (!pool) return res.status(503).json({ ok: false, error: 'PostgreSQL indisponível.' });
    await pool.query(
      `INSERT INTO zapmass.data_privacy_requests (tenant_id, actor_subject_id, request_type, status, note)
       VALUES ($1::uuid, $2, 'deletion', 'pending', $3)`,
      [ctx.tenantId, ctx.principal.authUid, note]
    );
    res.json({ ok: true, message: 'Solicitação registrada. Nossa equipe entrará em contato em até 15 dias úteis.' });
  });

  /** Aceite legal server-side */
  app.post('/api/tenant/legal-acceptance', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const docType = typeof req.body?.docType === 'string' ? req.body.docType.slice(0, 64) : 'whatsapp_risk';
    const docVersion =
      typeof req.body?.docVersion === 'string' ? req.body.docVersion.slice(0, 32) : WHATSAPP_RISK_VERSION;
    if (!isZapmassPostgresConfigured()) {
      return res.json({ ok: true, stored: false });
    }
    const pool = getZapmassPool();
    if (!pool) return res.json({ ok: true, stored: false });
    await pool.query(
      `INSERT INTO zapmass.legal_acceptances (tenant_id, actor_subject_id, doc_type, doc_version, ip, user_agent)
       VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
      [ctx.tenantId, ctx.principal.authUid, docType, docVersion, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 512)]
    );
    res.json({ ok: true, stored: true });
  });

  app.get('/api/tenant/legal-acceptances', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    if (!isZapmassPostgresConfigured()) {
      return res.json({ ok: true, items: [] });
    }
    const pool = getZapmassPool();
    if (!pool) return res.json({ ok: true, items: [] });
    const r = await pool.query(
      `SELECT doc_type, doc_version, accepted_at FROM zapmass.legal_acceptances
        WHERE tenant_id = $1::uuid ORDER BY accepted_at DESC LIMIT 20`,
      [ctx.tenantId]
    );
    res.json({ ok: true, items: r.rows });
  });

  /** Lista negra / opt-out global */
  app.get('/api/tenant/opt-out-list', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    if (!isZapmassPostgresConfigured()) return res.json({ ok: true, items: [] });
    const pool = getZapmassPool();
    if (!pool) return res.json({ ok: true, items: [] });
    const r = await pool.query(
      `SELECT id, phone_digits, reason, source, created_at FROM zapmass.contact_opt_outs
        WHERE tenant_id = $1::uuid ORDER BY created_at DESC LIMIT 500`,
      [ctx.tenantId]
    );
    res.json({ ok: true, items: r.rows });
  });

  app.post('/api/tenant/opt-out', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const digits = String(req.body?.phone || '').replace(/\D/g, '');
    if (digits.length < 10) {
      return res.status(400).json({ ok: false, error: 'Telefone inválido.' });
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : '';
    const source = typeof req.body?.source === 'string' ? req.body.source.slice(0, 32) : 'manual';
    if (!isZapmassPostgresConfigured()) {
      return res.status(503).json({ ok: false, error: 'PostgreSQL necessário.' });
    }
    const pool = getZapmassPool();
    if (!pool) return res.status(503).json({ ok: false, error: 'PostgreSQL indisponível.' });
    await pool.query(
      `INSERT INTO zapmass.contact_opt_outs (tenant_id, phone_digits, reason, source)
       VALUES ($1::uuid, $2, $3, $4)
       ON CONFLICT (tenant_id, phone_digits) DO UPDATE SET reason = EXCLUDED.reason, source = EXCLUDED.source`,
      [ctx.tenantId, digits, reason, source]
    );
    res.json({ ok: true });
  });

  app.delete('/api/tenant/opt-out/:phoneDigits', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const digits = String(req.params.phoneDigits || '').replace(/\D/g, '');
    if (!digits) return res.status(400).json({ ok: false, error: 'Telefone inválido.' });
    if (!isZapmassPostgresConfigured()) return res.json({ ok: true });
    const pool = getZapmassPool();
    if (!pool) return res.json({ ok: true });
    await pool.query(
      `DELETE FROM zapmass.contact_opt_outs WHERE tenant_id = $1::uuid AND phone_digits = $2`,
      [ctx.tenantId, digits]
    );
    res.json({ ok: true });
  });

  /** Minhas sugestões de melhoria com status */
  app.get('/api/product-suggestions/mine', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    if (!isZapmassPostgresConfigured()) return res.json({ ok: true, items: [] });
    const pool = getZapmassPool();
    if (!pool) return res.json({ ok: true, items: [] });
    const r = await pool.query(
      `SELECT id, text, screen, category, status, admin_note, created_at, updated_at
         FROM zapmass.product_suggestions
        WHERE tenant_id = $1::uuid AND actor_subject_id = $2
        ORDER BY created_at DESC LIMIT 50`,
      [ctx.tenantId, ctx.principal.authUid]
    );
    res.json({ ok: true, items: r.rows });
  });

  /** Teste do webhook configurado em Configurações → Notificações */
  app.post('/api/tenant/webhook-test', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const { loadTenantSettings } = await import('./tenantSettings.js');
    const { notifyTenantWebhook } = await import('./tenantNotifyService.js');
    const settings = await loadTenantSettings(ctx.tenantId);
    const url = (settings?.webhookUrl || process.env.WEBHOOK_URL || '').trim();
    if (!url) {
      return res.status(400).json({ ok: false, error: 'Configure a URL do webhook em Configurações → Notificações.' });
    }
    try {
      await notifyTenantWebhook(ctx.tenantId, 'test', {
        message: 'Teste de webhook ZapMass',
        tenantId: ctx.tenantId,
        at: new Date().toISOString()
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(502).json({ ok: false, error: (e as Error)?.message || 'Falha ao chamar webhook' });
    }
  });

  /** DLQ legado JSON (admin/tenant read-only) */
  app.get('/api/tenant/legacy-dlq', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const raw = await fs.readFile(DLQ_FILE, 'utf8');
      const all = JSON.parse(raw) as unknown[];
      const items = Array.isArray(all)
        ? all.filter((x) => {
            const row = x as { ownerUid?: string; tenantId?: string };
            return row.ownerUid === ctx.tenantId || row.tenantId === ctx.tenantId;
          }).slice(-100)
        : [];
      res.json({ ok: true, items });
    } catch {
      res.json({ ok: true, items: [] });
    }
  });
}
