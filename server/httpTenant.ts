import type { Request, Response } from 'express';
import { parseBearer, resolveAuthPrincipal } from './resolveAuth.js';
import type { AuthPrincipal } from './auth/types.js';

export async function requireTenant(
  req: Request,
  res: Response
): Promise<{ principal: AuthPrincipal; tenantId: string } | null> {
  const token = parseBearer(req);
  if (!token) {
    res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer.' });
    return null;
  }
  const principal = await resolveAuthPrincipal(token);
  if (!principal) {
    res.status(401).json({ ok: false, error: 'Token inválido ou expirado.' });
    return null;
  }
  return { principal, tenantId: principal.tenantUid };
}
