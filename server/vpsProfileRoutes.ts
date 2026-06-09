import type { Express, Request, Response } from 'express';
import { vpsAuthEnabled } from './auth/authMode.js';
import { buildVpsUserPayload } from './auth/profilePayload.js';
import {
  findStaffMemberById,
  updateStaffDisplayName,
  updateStaffPassword,
  updateStaffPhotoUrl,
  verifyStaffPassword
} from './auth/staffRepository.js';
import {
  findUserByEmail,
  findUserById,
  updateUserDisplayName,
  updateUserEmail,
  updateUserPassword,
  updateUserPhotoUrl,
  verifyUserPassword
} from './auth/userRepository.js';
import { getZapmassPool } from './db/postgres.js';
import { authProfileLimiter } from './httpRateLimit.js';
import { saveMediaFromBase64 } from './mediaStorage.js';
import { parseBearer, resolveAuthPrincipal } from './resolveAuth.js';
import { signAccessToken, accessTokenTtlSec } from './auth/jwt.js';

const ALLOWED_PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

function decodePhotoBase64(raw: string): { mime: string; buffer: Buffer } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const dataUrl = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(trimmed);
  if (dataUrl) {
    const mime = dataUrl[1].toLowerCase();
    if (!ALLOWED_PHOTO_MIME.has(mime)) return null;
    const buffer = Buffer.from(dataUrl[2], 'base64');
    return { mime, buffer };
  }
  const buffer = Buffer.from(trimmed, 'base64');
  return { mime: 'image/jpeg', buffer };
}

async function saveProfilePhoto(
  base64: string,
  userId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const decoded = decodePhotoBase64(base64);
  if (!decoded) {
    return { ok: false, error: 'Use uma imagem JPG, PNG ou WebP (máx. 2 MB).' };
  }
  if (decoded.buffer.length > MAX_PHOTO_BYTES) {
    return { ok: false, error: 'A foto deve ter no máximo 2 MB.' };
  }
  const ext = decoded.mime.includes('png') ? 'png' : decoded.mime.includes('webp') ? 'webp' : 'jpg';
  const fileName = `avatar_${userId.slice(0, 8)}_${Date.now()}.${ext}`;
  const { url } = await saveMediaFromBase64(base64, decoded.mime, fileName);
  return { ok: true, url };
}

async function requireVpsPrincipal(req: Request, res: Response) {
  const principal = await resolveAuthPrincipal(parseBearer(req));
  if (!principal || principal.provider !== 'vps') {
    res.status(401).json({ ok: false, error: 'Não autenticado.' });
    return null;
  }
  return principal;
}

export function registerVpsProfileRoutes(app: Express): void {
  if (!vpsAuthEnabled() || !getZapmassPool()) return;

  app.patch('/api/auth/profile', authProfileLimiter, async (req: Request, res: Response) => {
    const principal = await requireVpsPrincipal(req, res);
    if (!principal) return;

    const body = req.body as {
      displayName?: unknown;
      photoBase64?: unknown;
      removePhoto?: unknown;
    };
    const hasDisplayName = typeof body.displayName === 'string';
    const hasPhoto = typeof body.photoBase64 === 'string' && body.photoBase64.trim().length > 0;
    const removePhoto = body.removePhoto === true;

    if (!hasDisplayName && !hasPhoto && !removePhoto) {
      return res.status(400).json({ ok: false, error: 'Nada para atualizar.' });
    }

    try {
      if (principal.role === 'staff') {
        const member = await findStaffMemberById(principal.authUid);
        if (!member || member.revoked_at) {
          return res.status(403).json({ ok: false, error: 'Acesso revogado.' });
        }
        if (hasDisplayName) {
          const name = body.displayName as string;
          if (name.trim().length < 2 || name.trim().length > 80) {
            return res.status(400).json({ ok: false, error: 'Nome deve ter entre 2 e 80 caracteres.' });
          }
          await updateStaffDisplayName(member.id, name.trim());
        }
        if (removePhoto) await updateStaffPhotoUrl(member.id, null);
        else if (hasPhoto) {
          const saved = await saveProfilePhoto(body.photoBase64 as string, member.id);
          if (saved.ok === false) {
            return res.status(400).json({ ok: false, error: saved.error });
          }
          await updateStaffPhotoUrl(member.id, saved.url);
        }
      } else {
        if (hasDisplayName) {
          const name = body.displayName as string;
          if (name.trim().length > 80) {
            return res.status(400).json({ ok: false, error: 'Nome deve ter no máximo 80 caracteres.' });
          }
          await updateUserDisplayName(principal.tenantUid, name.trim());
        }
        if (removePhoto) await updateUserPhotoUrl(principal.tenantUid, null);
        else if (hasPhoto) {
          const saved = await saveProfilePhoto(body.photoBase64 as string, principal.tenantUid);
          if (saved.ok === false) {
            return res.status(400).json({ ok: false, error: saved.error });
          }
          await updateUserPhotoUrl(principal.tenantUid, saved.url);
        }
      }

      const user = await buildVpsUserPayload(principal);
      if (!user) return res.status(403).json({ ok: false, error: 'Conta indisponível.' });
      return res.json({ ok: true, user });
    } catch (e) {
      console.error('[auth/profile]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível atualizar o perfil.' });
    }
  });

  app.patch('/api/auth/email', authProfileLimiter, async (req: Request, res: Response) => {
    const principal = await requireVpsPrincipal(req, res);
    if (!principal) return;
    if (principal.role === 'staff') {
      return res.status(403).json({
        ok: false,
        error: 'Funcionários não alteram o e-mail de login. Peça ao gestor.'
      });
    }

    const body = req.body as { newEmail?: unknown; currentPassword?: unknown };
    const newEmail = typeof body.newEmail === 'string' ? body.newEmail.trim() : '';
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    if (!newEmail.includes('@') || currentPassword.length < 1) {
      return res.status(400).json({ ok: false, error: 'Informe o novo e-mail e a senha atual.' });
    }

    const user = await findUserById(principal.tenantUid);
    if (!user || !(await verifyUserPassword(user, currentPassword))) {
      return res.status(401).json({ ok: false, error: 'Senha atual incorreta.' });
    }
    const taken = await findUserByEmail(newEmail);
    if (taken && taken.id !== user.id) {
      return res.status(400).json({ ok: false, error: 'Este e-mail já está em uso.' });
    }

    try {
      await updateUserEmail(user.id, newEmail);
      const accessToken = await signAccessToken({
        sub: user.id,
        email: newEmail,
        role: 'owner',
        tenantUid: user.id
      });
      const payload = await buildVpsUserPayload({
        ...principal,
        email: newEmail
      });
      return res.json({
        ok: true,
        user: payload,
        accessToken,
        expiresIn: accessTokenTtlSec()
      });
    } catch (e) {
      console.error('[auth/email]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível alterar o e-mail.' });
    }
  });

  app.patch('/api/auth/password', authProfileLimiter, async (req: Request, res: Response) => {
    const principal = await requireVpsPrincipal(req, res);
    if (!principal) return;

    const body = req.body as { currentPassword?: unknown; newPassword?: unknown };
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!currentPassword || newPassword.length < 8) {
      return res.status(400).json({
        ok: false,
        error: 'Informe a senha atual e uma nova senha com mínimo 8 caracteres.'
      });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ ok: false, error: 'A nova senha deve ser diferente da atual.' });
    }

    try {
      if (principal.role === 'staff') {
        const member = await findStaffMemberById(principal.authUid);
        if (!member || member.revoked_at) {
          return res.status(403).json({ ok: false, error: 'Acesso revogado.' });
        }
        if (!(await verifyStaffPassword(member, currentPassword))) {
          return res.status(401).json({ ok: false, error: 'Senha atual incorreta.' });
        }
        await updateStaffPassword(member.id, newPassword);
      } else {
        const user = await findUserById(principal.tenantUid);
        if (!user || !(await verifyUserPassword(user, currentPassword))) {
          return res.status(401).json({ ok: false, error: 'Senha atual incorreta.' });
        }
        await updateUserPassword(user.id, newPassword);
      }
      return res.json({ ok: true });
    } catch (e) {
      console.error('[auth/password]', e);
      return res.status(500).json({ ok: false, error: 'Não foi possível alterar a senha.' });
    }
  });
}
