import rateLimit from 'express-rate-limit';
import type { Express, Request, Response } from 'express';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import {
  looksLikeSurveyToken,
  lookupSurveyInvite,
  submitSurveyInviteResponse
} from './inboxClientSurvey.js';

/** Submissões da página pública (sem login). */
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiadas tentativas. Tente mais tarde.' }
});

const metaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiadas consultas.' }
});

export function registerPublicInboxSurveyRoutes(app: Express): void {
  app.get('/api/public/inbox-survey/meta', metaLimiter, async (req: Request, res: Response) => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, error: 'Serviço indisponível.' });
    }
    const token = String(req.query.token || '').trim();
    if (!looksLikeSurveyToken(token)) {
      return res.status(400).json({ ok: false, error: 'Link inválido.' });
    }
    try {
      const st = await lookupSurveyInvite(adminApp.firestore(), token);
      if (st.status === 'not_found') return res.status(404).json({ ok: false, error: 'Link inválido ou expirado.' });
      if (st.status === 'expired') return res.json({ ok: true, state: 'expired' });
      if (st.status === 'already_used') return res.json({ ok: true, state: 'already_used' });
      return res.json({ ok: true, state: 'open' });
    } catch (e) {
      console.error('[public/inbox-survey/meta]', e);
      return res.status(500).json({ ok: false, error: 'Falha ao verificar.' });
    }
  });

  app.post('/api/public/inbox-survey/submit', submitLimiter, async (req: Request, res: Response) => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, error: 'Serviço indisponível.' });
    }
    const body = req.body as { token?: unknown; rating?: unknown; comment?: unknown };
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!looksLikeSurveyToken(token)) {
      return res.status(400).json({ ok: false, error: 'Link inválido.' });
    }
    let rating = 0;
    if (typeof body.rating === 'number') rating = body.rating;
    else if (typeof body.rating === 'string' && /^\d$/.test(body.rating)) rating = Number(body.rating);
    const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) : '';

    try {
      const r = await submitSurveyInviteResponse(adminApp.firestore(), token, rating, comment);
      if (r.ok === false) {
        const map: Record<string, { status: number; msg: string }> = {
          NOT_FOUND: { status: 404, msg: 'Link inválido ou expirado.' },
          USED: { status: 409, msg: 'Esta avaliação já foi enviada.' },
          EXPIRED: { status: 410, msg: 'Este link já não está válido.' },
          BAD_RATING: { status: 400, msg: 'Indique uma nota de 1 a 5.' }
        };
        const m = map[r.code];
        return res.status(m.status).json({ ok: false, error: m.msg });
      }
      return res.json({ ok: true });
    } catch (e) {
      console.error('[public/inbox-survey/submit]', e);
      return res.status(500).json({ ok: false, error: 'Falha ao guardar avaliação.' });
    }
  });
}
