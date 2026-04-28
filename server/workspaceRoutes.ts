import type { Express, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';

function parseBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function registerWorkspaceRoutes(app: Express): void {
  /**
   * Gera código de convite (dono da conta). Requer Firebase ID token.
   * Resposta: { ok: true, code: string, expiresAt: string (ISO) }
   */
  app.post('/api/workspace/create-invite', async (req: Request, res: Response) => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin não configurado no servidor.' });
    }
    const token = parseBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer <Firebase ID token>.' });
    }
    try {
      const decoded = await getAuth(adminApp).verifyIdToken(token);
      const db = adminApp.firestore();
      const code = randomBytes(12).toString('hex'); // 24 chars — difícil de adivinhar
      const now = Date.now();
      await db
        .collection('workspace_invites')
        .doc(code)
        .set({
          ownerUid: decoded.uid,
          createdAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromMillis(now + INVITE_TTL_MS),
          used: false
        });
      return res.json({
        ok: true,
        code,
        expiresAt: new Date(now + INVITE_TTL_MS).toISOString()
      });
    } catch (e) {
      console.error('[workspace/create-invite]', e);
      return res.status(400).json({ ok: false, error: 'Token inválido ou erro ao criar convite.' });
    }
  });

  /**
   * Associa utilizador ao workspace do convite (funcionário). Requer Bearer (conta google do funcionário).
   */
  app.post('/api/workspace/redeem', async (req: Request, res: Response) => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin não configurado no servidor.' });
    }
    const token = parseBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer <Firebase ID token>.' });
    }
    const code = typeof (req.body as { code?: unknown })?.code === 'string' ? String(req.body.code).trim() : '';
    if (code.length < 8) {
      return res.status(400).json({ ok: false, error: 'Código de convite inválido.' });
    }
    try {
      const decoded = await getAuth(adminApp).verifyIdToken(token);
      const staffUid = decoded.uid;
      const db = adminApp.firestore();
      const inviteRef = db.collection('workspace_invites').doc(code);

      await db.runTransaction(async (tx) => {
        const inviteSnap = await tx.get(inviteRef);
        const linkRef = db.collection('userWorkspaceLinks').doc(staffUid);
        const existingSnap = await tx.get(linkRef);
        if (!inviteSnap.exists) {
          throw new Error('INVITE_NOT_FOUND');
        }
        const d = inviteSnap.data()!;
        if (d.used === true) {
          throw new Error('INVITE_USED');
        }
        const exp = d.expiresAt as Timestamp | undefined;
        if (exp && exp.toMillis() < Date.now()) {
          throw new Error('INVITE_EXPIRED');
        }
        const ownerUid = typeof d.ownerUid === 'string' ? d.ownerUid : '';
        if (!ownerUid || ownerUid === staffUid) {
          throw new Error('INVITE_INVALID');
        }
        if (existingSnap.exists) {
          const cur = existingSnap.data()?.ownerUid;
          if (typeof cur === 'string' && cur && cur === ownerUid) {
            tx.update(inviteRef, {
              used: true,
              redeemedBy: staffUid,
              redeemedAt: FieldValue.serverTimestamp()
            });
            return;
          }
          if (typeof cur === 'string' && cur && cur !== ownerUid) {
            throw new Error('ALREADY_LINKED');
          }
        }
        tx.update(inviteRef, {
          used: true,
          redeemedBy: staffUid,
          redeemedAt: FieldValue.serverTimestamp()
        });
        tx.set(linkRef, {
          ownerUid,
          linkedAt: FieldValue.serverTimestamp()
        });
      });

      return res.json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const map: Record<string, string> = {
        INVITE_NOT_FOUND: 'Código não encontrado.',
        INVITE_USED: 'Este convite já foi usado.',
        INVITE_EXPIRED: 'Convite expirado. Peça um novo ao administrador.',
        INVITE_INVALID: 'Convite inválido.',
        ALREADY_LINKED: 'Sua conta já está ligada a outro workspace. Saia antes de aceitar outro convite.'
      };
      if (map[msg]) {
        return res.status(400).json({ ok: false, error: map[msg] });
      }
      console.error('[workspace/redeem]', e);
      return res.status(400).json({ ok: false, error: 'Não foi possível activar o convite.' });
    }
  });

  /** Funcionário remove o vínculo (volta à conta própria). */
  app.delete('/api/workspace/leave', async (req: Request, res: Response) => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin não configurado no servidor.' });
    }
    const token = parseBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer <Firebase ID token>.' });
    }
    try {
      const decoded = await getAuth(adminApp).verifyIdToken(token);
      await adminApp.firestore().collection('userWorkspaceLinks').doc(decoded.uid).delete();
      return res.json({ ok: true });
    } catch (e) {
      console.error('[workspace/leave]', e);
      return res.status(400).json({ ok: false, error: 'Não foi possível sair do workspace.' });
    }
  });

  /** Dono remove acesso de um membro (por UID do membro). */
  app.delete('/api/workspace/member/:staffUid', async (req: Request, res: Response) => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin não configurado no servidor.' });
    }
    const token = parseBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer <Firebase ID token>.' });
    }
    const staffUid = String(req.params.staffUid || '').trim();
    if (!staffUid) {
      return res.status(400).json({ ok: false, error: 'staffUid necessário.' });
    }
    try {
      const decoded = await getAuth(adminApp).verifyIdToken(token);
      const ownerUid = decoded.uid;
      const db = adminApp.firestore();
      const linkRef = db.collection('userWorkspaceLinks').doc(staffUid);
      const snap = await linkRef.get();
      if (!snap.exists) {
        return res.status(404).json({ ok: false, error: 'Membro não encontrado.' });
      }
      const ou = snap.data()?.ownerUid;
      if (ou !== ownerUid) {
        return res.status(403).json({ ok: false, error: 'Sem permissão para revogar este vínculo.' });
      }
      await linkRef.delete();
      return res.json({ ok: true });
    } catch (e) {
      console.error('[workspace/member]', e);
      return res.status(400).json({ ok: false, error: 'Falha ao revogar acesso.' });
    }
  });
}
