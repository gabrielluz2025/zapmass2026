import type { Express, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import {
  adminEmailSet,
  adminUidSet,
  isPlatformAdminDecoded,
  platformAdminDenyHint
} from './adminIdentity.js';
import { vpsAuthRequired } from './auth/authMode.js';
import { parseBearer, resolveAuthPrincipal } from './resolveAuth.js';

export { adminEmailSet, adminUidSet } from './adminIdentity.js';
export { parseBearer } from './resolveAuth.js';

async function resolveEmailForAdminCheck(
  adminApp: NonNullable<ReturnType<typeof getFirebaseAdmin>>,
  uid: string,
  tokenEmail: string
): Promise<string> {
  if (tokenEmail.trim()) return tokenEmail;
  try {
    const u = await getAuth(adminApp).getUser(uid);
    return typeof u.email === 'string' ? u.email : '';
  } catch {
    return '';
  }
}

export async function assertAdminFromBearer(
  req: Request,
  res: Response
): Promise<{ uid: string; email: string } | null> {
  const token = parseBearer(req);
  if (!token) {
    res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer <token>.' });
    return null;
  }
  const principal = await resolveAuthPrincipal(token);
  if (principal) {
    const shape = { uid: principal.authUid, email: principal.email, admin: false };
    if (isPlatformAdminDecoded(shape)) {
      return { uid: principal.authUid, email: principal.email || principal.authUid };
    }
    res.status(403).json({
      ok: false,
      error: 'Acesso restrito a administradores.',
      hint: platformAdminDenyHint()
    });
    return null;
  }
  if (vpsAuthRequired()) {
    res.status(401).json({
      ok: false,
      error: 'Token inválido ou expirado. Entre com e-mail e senha (modo VPS).',
      hint: platformAdminDenyHint()
    });
    return null;
  }
  const adminApp = getFirebaseAdmin();
  if (!adminApp) {
    res.status(503).json({ ok: false, error: 'Autenticação não configurada no servidor.' });
    return null;
  }
  try {
    const decoded = await getAuth(adminApp).verifyIdToken(token);
    const tokenEmail = typeof decoded.email === 'string' ? decoded.email : '';
    const shape = {
      uid: decoded.uid,
      email: tokenEmail,
      admin: decoded.admin === true
    };
    if (isPlatformAdminDecoded(shape)) {
      const email =
        tokenEmail || (await resolveEmailForAdminCheck(adminApp, decoded.uid, tokenEmail));
      return { uid: decoded.uid, email: email || decoded.uid };
    }
    const resolvedEmail = await resolveEmailForAdminCheck(adminApp, decoded.uid, tokenEmail);
    if (
      isPlatformAdminDecoded({
        uid: decoded.uid,
        email: resolvedEmail,
        admin: decoded.admin === true
      })
    ) {
      return { uid: decoded.uid, email: resolvedEmail || decoded.uid };
    }
    res.status(403).json({
      ok: false,
      error: 'Acesso restrito a administradores.',
      hint: platformAdminDenyHint()
    });
    return null;
  } catch {
    res.status(401).json({ ok: false, error: 'Token inválido ou expirado.' });
    return null;
  }
}

/** Confirma se o token atual é admin de plataforma (menu vs API). */
export function registerAdminAuthRoutes(app: Express): void {
  app.get('/api/admin/session', async (req: Request, res: Response) => {
    const token = parseBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, admin: false, error: 'Bearer token obrigatorio.' });
    }
    const principal = await resolveAuthPrincipal(token);
    if (principal) {
      const admin = isPlatformAdminDecoded({
        uid: principal.authUid,
        email: principal.email,
        admin: false
      });
      if (!admin) {
        return res.status(403).json({
          ok: false,
          admin: false,
          uid: principal.authUid,
          email: principal.email || null,
          hint: platformAdminDenyHint(),
          serverHasAdminEmails: adminEmailSet().size > 0,
          serverHasAdminUids: adminUidSet().size > 0
        });
      }
      return res.json({
        ok: true,
        admin: true,
        uid: principal.authUid,
        email: principal.email || principal.authUid
      });
    }
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, admin: false, error: 'Autenticação não configurada.' });
    }
    try {
      const decoded = await getAuth(adminApp).verifyIdToken(token);
      const tokenEmail = typeof decoded.email === 'string' ? decoded.email : '';
      let admin = isPlatformAdminDecoded({
        uid: decoded.uid,
        email: tokenEmail,
        admin: decoded.admin === true
      });
      let email = tokenEmail;
      if (!admin) {
        email = await resolveEmailForAdminCheck(adminApp, decoded.uid, tokenEmail);
        admin = isPlatformAdminDecoded({
          uid: decoded.uid,
          email,
          admin: decoded.admin === true
        });
      }
      if (!admin) {
        return res.status(403).json({
          ok: false,
          admin: false,
          uid: decoded.uid,
          email: email || null,
          hint: platformAdminDenyHint(),
          serverHasAdminEmails: adminEmailSet().size > 0,
          serverHasAdminUids: adminUidSet().size > 0
        });
      }
      return res.json({
        ok: true,
        admin: true,
        uid: decoded.uid,
        email: email || decoded.uid
      });
    } catch {
      return res.status(401).json({ ok: false, admin: false, error: 'Token invalido ou expirado.' });
    }
  });
}
