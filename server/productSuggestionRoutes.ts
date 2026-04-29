import type { Express, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';

function parseBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

/**
 * Sugestões de melhoria (botão «Sugestão» no app).
 * Gravação via Admin SDK para não depender das regras de segurança do cliente no Firestore.
 */
export function registerProductSuggestionRoutes(app: Express): void {
  app.post('/api/product-suggestion', async (req: Request, res: Response) => {
    try {
      const adminApp = getFirebaseAdmin();
      if (!adminApp) {
        return res.status(503).json({ ok: false, error: 'Servidor sem Firebase Admin configurado.' });
      }
      const token = parseBearer(req);
      if (!token) {
        return res.status(401).json({ ok: false, error: 'Autenticação em falta (token Firebase).' });
      }
      const decoded = await getAuth(adminApp).verifyIdToken(token);
      const uid = decoded.uid;
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (text.length < 1) {
        return res.status(400).json({ ok: false, error: 'Escreva uma sugestão.' });
      }
      if (text.length > 8000) {
        return res.status(400).json({ ok: false, error: 'Texto demasiado longo.' });
      }
      const screen = typeof req.body?.screen === 'string' ? req.body.screen.slice(0, 64) : '';
      const categoryRaw = typeof req.body?.category === 'string' ? req.body.category.trim().toLowerCase() : '';
      const allowedCat = new Set(['usability', 'campaigns', 'reports', 'integrations', 'other']);
      const category = allowedCat.has(categoryRaw) ? categoryRaw : 'other';
      const email =
        typeof decoded.email === 'string'
          ? decoded.email.slice(0, 320)
          : '';

      const db = getFirestore(adminApp);
      await db.collection('users').doc(uid).collection('suggestions').add({
        text,
        createdAt: FieldValue.serverTimestamp(),
        screen,
        category,
        userEmail: email
      });

      return res.json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[api/product-suggestion]', msg);
      return res.status(500).json({ ok: false, error: msg });
    }
  });
}
