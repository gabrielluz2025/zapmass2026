import type { Express, Request, Response } from 'express';
import { getZapmassPool } from './db/postgres.js';
import { vpsAuthEnabled } from './auth/authMode.js';
import { parseBearer, resolveAuthPrincipal } from './resolveAuth.js';
import { countActiveStaffMembers, createStaffMember, findStaffMember } from './auth/staffRepository.js';
import { hashPassword } from './auth/password.js';
import { getMaxStaffPasswordAccounts, sanitizeLoginSlug } from './workspaceStaffPasswordRoutes.js';

async function assertOwnerVps(req: Request, res: Response): Promise<{ ownerUid: string } | null> {
  const principal = await resolveAuthPrincipal(parseBearer(req));
  if (!principal) {
    res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer.' });
    return null;
  }
  if (principal.role !== 'owner' || principal.authUid !== principal.tenantUid) {
    res.status(403).json({ ok: false, error: 'Apenas o administrador principal pode gerir funcionários.' });
    return null;
  }
  return { ownerUid: principal.tenantUid };
}

export function registerVpsWorkspaceStaffRoutes(app: Express): void {
  if (!vpsAuthEnabled() || !getZapmassPool()) return;

  app.get('/api/workspace/staff-password-users', async (req: Request, res: Response) => {
    const owner = await assertOwnerVps(req, res);
    if (!owner) return;
    const pool = getZapmassPool();
    if (!pool) return res.status(503).json({ ok: false, error: 'Postgres indisponível.' });
    const r = await pool.query<{
      id: string;
      login_slug: string;
      display_name: string;
      created_at: Date;
    }>(
      `SELECT id::text, login_slug, display_name, created_at
       FROM zapmass.workspace_members
       WHERE owner_user_id = $1::uuid AND revoked_at IS NULL
       ORDER BY login_slug`,
      [owner.ownerUid]
    );
    return res.json({
      ok: true,
      max: getMaxStaffPasswordAccounts(),
      users: r.rows.map((row) => ({
        staffAuthUid: row.id,
        loginSlug: row.login_slug,
        displayName: row.display_name,
        createdAt: row.created_at
      }))
    });
  });

  app.post('/api/workspace/staff-password-users', async (req: Request, res: Response) => {
    const owner = await assertOwnerVps(req, res);
    if (!owner) return;
    const body = req.body as { loginName?: unknown; password?: unknown; displayName?: unknown };
    const loginName = typeof body.loginName === 'string' ? body.loginName : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    const slug = sanitizeLoginSlug(loginName);
    if (!slug || password.length < 8) {
      return res.status(400).json({
        ok: false,
        error: 'Nome de usuário (3–28 caracteres) e senha com mínimo 8 caracteres.'
      });
    }
    const count = await countActiveStaffMembers(owner.ownerUid);
    if (count >= getMaxStaffPasswordAccounts()) {
      return res.status(400).json({
        ok: false,
        error: `Limite de ${getMaxStaffPasswordAccounts()} funcionários com senha.`
      });
    }
    const existing = await findStaffMember(owner.ownerUid, slug);
    if (existing && !existing.revoked_at) {
      return res.status(400).json({ ok: false, error: 'Este nome de usuário já existe.' });
    }
    try {
      const member = await createStaffMember({
        ownerUserId: owner.ownerUid,
        loginSlug: slug,
        password,
        displayName: displayName || slug
      });
      return res.json({
        ok: true,
        loginSlug: slug,
        staffAuthUid: member.id
      });
    } catch (e) {
      console.error('[vps workspace staff POST]', e);
      return res.status(400).json({ ok: false, error: 'Não foi possível criar o acesso.' });
    }
  });

  app.patch('/api/workspace/staff-password-users/:staffAuthUid', async (req: Request, res: Response) => {
    const owner = await assertOwnerVps(req, res);
    if (!owner) return;
    const staffAuthUid = String(req.params.staffAuthUid || '').trim();
    const password = typeof (req.body as { password?: unknown })?.password === 'string'
      ? (req.body as { password: string }).password
      : '';
    if (!staffAuthUid || password.length < 8) {
      return res.status(400).json({ ok: false, error: 'Senha com mínimo 8 caracteres.' });
    }
    const pool = getZapmassPool();
    if (!pool) return res.status(503).json({ ok: false, error: 'Postgres indisponível.' });
    const password_hash = await hashPassword(password);
    const r = await pool.query(
      `UPDATE zapmass.workspace_members
       SET password_hash = $1
       WHERE id = $2::uuid AND owner_user_id = $3::uuid AND revoked_at IS NULL`,
      [password_hash, staffAuthUid, owner.ownerUid]
    );
    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Funcionário não encontrado.' });
    }
    return res.json({ ok: true });
  });

  app.delete('/api/workspace/staff-password-users/:staffAuthUid', async (req: Request, res: Response) => {
    const owner = await assertOwnerVps(req, res);
    if (!owner) return;
    const staffAuthUid = String(req.params.staffAuthUid || '').trim();
    const purge =
      String(req.query.purge ?? '').toLowerCase() === 'true' || req.query.purge === '1';
    const pool = getZapmassPool();
    if (!pool) return res.status(503).json({ ok: false, error: 'Postgres indisponível.' });
    if (purge) {
      await pool.query(
        `DELETE FROM zapmass.workspace_members WHERE id = $1::uuid AND owner_user_id = $2::uuid`,
        [staffAuthUid, owner.ownerUid]
      );
    } else {
      await pool.query(
        `UPDATE zapmass.workspace_members SET revoked_at = now()
         WHERE id = $1::uuid AND owner_user_id = $2::uuid AND revoked_at IS NULL`,
        [staffAuthUid, owner.ownerUid]
      );
    }
    return res.json({ ok: true });
  });
}
