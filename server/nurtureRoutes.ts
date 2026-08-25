import type { Express, Request, Response } from 'express';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { requireTenant } from './httpTenant.js';
import { saveMediaFromBase64 } from './mediaStorage.js';
import {
  cancelNurtureEnrollment,
  enrollContactInNurture,
  forceDispatchNurtureEnrollments
} from './nurture/nurtureEngine.js';
import {
  listHotLeadCandidates,
  syncHotLeadEnrollments
} from './nurture/nurtureHotLeads.js';
import {
  findEnrollmentByPhonePg,
  getOrCreatePrimaryJourneyPg,
  listNurtureEnrollmentsPg,
  loadNurtureMetricsPg,
  normalizeNurtureJourneyDoc,
  saveNurtureJourneyPg
} from './nurture/nurtureRepository.js';
import type { NurtureJourneyDoc } from './nurture/nurtureTypes.js';

export function registerNurtureRoutes(app: Express): void {
  if (!vpsDataEnabled() || !getZapmassPool()) return;

  app.get('/api/nurture', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const journey = await getOrCreatePrimaryJourneyPg(ctx.tenantId);
      const metrics = await loadNurtureMetricsPg(ctx.tenantId, journey.id);
      const status = String(req.query.status ?? 'all').trim();
      const search = String(req.query.search ?? '').trim();
      const enrollments = await listNurtureEnrollmentsPg(ctx.tenantId, journey.id, 100, {
        status: status || 'all',
        search
      });
      return res.json({ ok: true, journey, metrics, enrollments });
    } catch (e) {
      console.error('[nurture GET]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível carregar a jornada.' });
    }
  });

  app.patch('/api/nurture', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = req.body as {
      journeyId?: string;
      name?: string;
      enabled?: boolean;
      doc?: unknown;
    };
    try {
      const current = await getOrCreatePrimaryJourneyPg(ctx.tenantId);
      const journeyId = body.journeyId || current.id;
      const doc: NurtureJourneyDoc | undefined = body.doc
        ? normalizeNurtureJourneyDoc(body.doc)
        : undefined;
      const journey = await saveNurtureJourneyPg(ctx.tenantId, journeyId, {
        name: body.name,
        enabled: body.enabled,
        doc
      });
      const metrics = await loadNurtureMetricsPg(ctx.tenantId, journey.id);
      return res.json({ ok: true, journey, metrics });
    } catch (e) {
      console.error('[nurture PATCH]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível salvar a jornada.' });
    }
  });

  app.get('/api/nurture/enrollment', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const phone = String(req.query.phone ?? '').replace(/\D/g, '');
    if (!phone) {
      return res.status(400).json({ ok: false, error: 'Informe ?phone= com dígitos do contato.' });
    }
    try {
      const enrollment = await findEnrollmentByPhonePg(ctx.tenantId, phone);
      return res.json({ ok: true, enrollment });
    } catch (e) {
      console.error('[nurture enrollment GET]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível consultar a inscrição.' });
    }
  });

  app.post('/api/nurture/enroll', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = req.body as {
      contactPhone?: string;
      connectionId?: string;
      conversationId?: string;
      journeyId?: string;
      manual?: boolean;
    };
    const phone = String(body.contactPhone ?? '').replace(/\D/g, '');
    const connectionId = String(body.connectionId ?? '').trim();
    if (!phone || !connectionId) {
      return res.status(400).json({ ok: false, error: 'Envie contactPhone e connectionId.' });
    }
    const result = await enrollContactInNurture({
      tenantId: ctx.tenantId,
      contactPhone: phone,
      connectionId,
      conversationId: body.conversationId,
      journeyId: body.journeyId
    });
    if (!result.ok) {
      return res.status(400).json(result);
    }
    const journey = await getOrCreatePrimaryJourneyPg(ctx.tenantId);
    const enrollment = await findEnrollmentByPhonePg(ctx.tenantId, phone);
    const enrollments = await listNurtureEnrollmentsPg(ctx.tenantId, journey.id, 100);
    return res.json({ ok: true, enrollment, enrollments });
  });

  app.get('/api/nurture/hot-leads', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const result = await listHotLeadCandidates(ctx.tenantId, { limit, offset });
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error('[nurture hot-leads GET]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível listar leads quentes.' });
    }
  });

  app.post('/api/nurture/enroll-hot-leads', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = (req.body || {}) as {
      offset?: number;
      limit?: number;
      dryRun?: boolean;
      connectionId?: string;
    };
    try {
      const result = await syncHotLeadEnrollments(ctx.tenantId, {
        offset: body.offset,
        limit: body.limit,
        dryRun: body.dryRun !== false,
        connectionId: body.connectionId
      });
      return res.json({ ok: true, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao inscrever leads quentes.';
      console.error('[nurture enroll-hot-leads]', e);
      return res.status(400).json({ ok: false, error: msg });
    }
  });

  app.post('/api/nurture/media', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = req.body as { dataBase64?: string; mimeType?: string; fileName?: string };
    const dataBase64 = String(body.dataBase64 ?? '').trim();
    const mimeType = String(body.mimeType ?? '').trim();
    const fileName = String(body.fileName ?? 'anexo').trim().slice(0, 200) || 'anexo';
    if (!dataBase64 || !mimeType) {
      return res.status(400).json({ ok: false, error: 'Envie dataBase64 e mimeType.' });
    }
    try {
      const saved = await saveMediaFromBase64(dataBase64, mimeType, fileName);
      return res.json({ ok: true, url: saved.url });
    } catch (e) {
      console.error('[nurture media]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível salvar a mídia.' });
    }
  });

  app.post('/api/nurture/dispatch', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const body = req.body as {
      journeyId?: string;
      enrollmentIds?: string[];
      allActive?: boolean;
    };
    try {
      const journey = await getOrCreatePrimaryJourneyPg(ctx.tenantId);
      const journeyId = body.journeyId || journey.id;
      const result = await forceDispatchNurtureEnrollments({
        tenantId: ctx.tenantId,
        journeyId,
        enrollmentIds: Array.isArray(body.enrollmentIds) ? body.enrollmentIds : undefined,
        allActive: body.allActive === true
      });
      if (!result.ok) {
        return res.status(400).json(result);
      }
      const enrollments = await listNurtureEnrollmentsPg(ctx.tenantId, journeyId, 100);
      return res.json({ ok: true, queued: result.queued, enrollments });
    } catch (e) {
      console.error('[nurture dispatch]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível disparar a jornada.' });
    }
  });

  app.post('/api/nurture/enrollments/cancel', async (req: Request, res: Response) => {
    const ctx = await requireTenant(req, res);
    if (!ctx) return;
    const enrollmentId = String((req.body as { enrollmentId?: string })?.enrollmentId ?? '').trim();
    if (!enrollmentId) {
      return res.status(400).json({ ok: false, error: 'Envie enrollmentId.' });
    }
    try {
      await cancelNurtureEnrollment(ctx.tenantId, enrollmentId);
      const journey = await getOrCreatePrimaryJourneyPg(ctx.tenantId);
      const enrollments = await listNurtureEnrollmentsPg(ctx.tenantId, journey.id, 50);
      return res.json({ ok: true, enrollments });
    } catch (e) {
      console.error('[nurture cancel]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível cancelar a inscrição.' });
    }
  });
}
