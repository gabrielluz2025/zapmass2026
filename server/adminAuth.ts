import type { Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdmin } from './firebaseAdmin.js';

export function parseBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

export function adminEmailSet(): Set<string> {
  const raw = process.env.ADMIN_EMAILS?.trim() || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function assertAdminFromBearer(
  req: Request,
  res: Response
): Promise<{ uid: string; email: string } | null> {
  const adminApp = getFirebaseAdmin();
  if (!adminApp) {
    res.status(503).json({ ok: false, error: 'Firebase Admin nao configurado no servidor.' });
    return null;
  }
  const token = parseBearer(req);
  if (!token) {
    res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer <Firebase ID token>.' });
    return null;
  }
  try {
    const decoded = await getAuth(adminApp).verifyIdToken(token);
    const email = typeof decoded.email === 'string' ? decoded.email : '';
    const allow = adminEmailSet();
    const claimAdmin = decoded.admin === true;
    if (!claimAdmin && (!email || !allow.has(email.toLowerCase()))) {
      res.status(403).json({ ok: false, error: 'Acesso restrito a administradores.' });
      return null;
    }
    return { uid: decoded.uid, email: email || decoded.uid };
  } catch {
    res.status(401).json({ ok: false, error: 'Token Firebase invalido ou expirado.' });
    return null;
  }
}
