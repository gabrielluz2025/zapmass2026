import type { Express, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { workspaceInviteLimiter } from './httpRateLimit.js';
import { ownsConnectionForUid } from '../src/utils/connectionScope.js';
import { resolveConnectionOwnerUid } from './evolutionService.js';
import {
  assignmentsSnapshotForTenant,
  ensureAssignmentsLoaded,
  inboxClaimConversation,
  inboxFinishConversation,
  inboxTransferConversation,
  inboxReleaseConversation
} from './inboxAssignments.js';
import { getConversations, broadcastConversationsUpdate } from './whatsappService.js';
import { submitSendMessage } from './sessionControlPlane.js';
import {
  buildClientSurveyUrl,
  createPublicSurveyInvite,
  whatsappSurveyMessageBody
} from './inboxClientSurvey.js';
import { getSurveyLinksBaseOrigin } from './publicSurveyAppOrigin.js';
import { vpsAuthEnabled, vpsAuthRequired } from './auth/authMode.js';
import { getZapmassPool } from './db/postgres.js';
import { resolveAuthPrincipal } from './resolveAuth.js';

function parseBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

/** Dono ou membro da equipa (mesmo tenant em `users/{ownerUid}/...`). */
async function resolveWorkspaceParticipant(
  adminApp: NonNullable<ReturnType<typeof getFirebaseAdmin>>,
  token: string
): Promise<{ tenantUid: string; authUid: string }> {
  const decoded = await getAuth(adminApp).verifyIdToken(token);
  const authUid = decoded.uid;
  const linkSnap = await adminApp.firestore().collection('userWorkspaceLinks').doc(authUid).get();
  const ou = linkSnap.exists ? linkSnap.data()?.ownerUid : null;
  const tenantUid = typeof ou === 'string' && ou.trim() ? ou.trim() : authUid;
  return { tenantUid, authUid };
}

/** Só o dono da conta (sem estar ligado a workspace de terceiros) pode usar rotas administrativas. */
async function assertWorkspaceOwner(adminApp: NonNullable<ReturnType<typeof getFirebaseAdmin>>, token: string) {
  const decoded = await getAuth(adminApp).verifyIdToken(token);
  const uid = decoded.uid;
  const db = adminApp.firestore();
  const linkSnap = await db.collection('userWorkspaceLinks').doc(uid).get();
  const ou = linkSnap.exists ? linkSnap.data()?.ownerUid : null;
  const isStaff = typeof ou === 'string' && ou.trim().length > 0 && ou !== uid;
  if (isStaff) {
    throw new Error('NOT_OWNER');
  }
  return { uid, db };
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function registerWorkspaceRoutes(app: Express): void {
  /**
   * Gera código de convite (dono da conta). Requer Firebase ID token.
   * Resposta: { ok: true, code: string, expiresAt: string (ISO) }
   */
  app.post('/api/workspace/create-invite', workspaceInviteLimiter, async (req: Request, res: Response) => {
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
  app.post('/api/workspace/redeem', workspaceInviteLimiter, async (req: Request, res: Response) => {
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
      const linkData = snap.data()!;
      const staffSlug =
        typeof linkData.staffLoginSlug === 'string' && linkData.staffLoginSlug.trim()
          ? linkData.staffLoginSlug.trim()
          : '';

      await linkRef.delete();

      if (staffSlug) {
        const metaRef = db.collection('users').doc(ownerUid).collection('staffPasswordUsers').doc(staffSlug);
        const metaSnap = await metaRef.get();
        if (metaSnap.exists && metaSnap.data()?.staffAuthUid === staffUid && metaSnap.data()?.revokedAt == null) {
          try {
            await getAuth(adminApp).updateUser(staffUid, { disabled: true });
          } catch {
            /* possivelmente já apagado */
          }
          await metaRef.update({ revokedAt: FieldValue.serverTimestamp() });
        }
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error('[workspace/member]', e);
      return res.status(400).json({ ok: false, error: 'Falha ao revogar acesso.' });
    }
  });

  /**
   * Lista membros da equipa com vínculo ativo (convite Google ou login por senha).
   * Em auth VPS: ver `registerVpsWorkspaceStaffRoutes`.
   */
  if (!vpsAuthEnabled()) app.get('/api/workspace/members', async (req: Request, res: Response) => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin não configurado no servidor.' });
    }
    const token = parseBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer.' });
    }
    try {
      const { uid: ownerUid } = await assertWorkspaceOwner(adminApp, token);
      const snap = await adminApp
        .firestore()
        .collection('userWorkspaceLinks')
        .where('ownerUid', '==', ownerUid)
        .get();

      type Row = {
        uid: string;
        source: 'invite' | 'password';
        loginSlug: string | null;
        email: string | null;
        displayName: string | null;
        linkedAt: string | null;
      };

      const items: Row[] = [];
      const auth = getAuth(adminApp);

      snap.forEach((docSnap) => {
        const membershipUid = docSnap.id;
        if (membershipUid === ownerUid) return;
        const d = docSnap.data();
        const staffLoginSlug = typeof d.staffLoginSlug === 'string' && d.staffLoginSlug.trim() ? d.staffLoginSlug.trim() : null;
        const linkedAtIso =
          d.linkedAt instanceof Timestamp ? d.linkedAt.toDate().toISOString() : typeof d.linkedAt === 'string' ? d.linkedAt : null;

        items.push({
          uid: membershipUid,
          source: staffLoginSlug ? 'password' : 'invite',
          loginSlug: staffLoginSlug,
          email: null,
          displayName: null,
          linkedAt: linkedAtIso
        });
      });

      await Promise.all(
        items.map(async (row) => {
          try {
            const u = await auth.getUser(row.uid);
            row.email = u.email ?? null;
            row.displayName = u.displayName ?? null;
          } catch {
            /* conta apagada */
          }
        })
      );

      items.sort((a, b) => {
        const la = (a.linkedAt ?? '').slice(0, 19);
        const lb = (b.linkedAt ?? '').slice(0, 19);
        return lb.localeCompare(la);
      });

      return res.json({ ok: true, items });
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'NOT_OWNER') {
        return res.status(403).json({ ok: false, error: 'Apenas o responsável pela conta pode ver a equipa.' });
      }
      console.error('[workspace/members]', e);
      return res.status(400).json({ ok: false, error: 'Falha ao listar a equipa.' });
    }
  });

  /** Dono ou equipa na mesma workspace: lista UID + nomes para transferência de inbox. */
  app.get('/api/workspace/teammates', async (req: Request, res: Response) => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin não configurado no servidor.' });
    }
    const token = parseBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer.' });
    }
    try {
      const { tenantUid } = await resolveWorkspaceParticipant(adminApp, token);
      type Row = { uid: string; displayName: string | null; email: string | null; role: 'owner' | 'staff' };
      const items: Row[] = [];
      const auth = getAuth(adminApp);
      try {
        const ou = await auth.getUser(tenantUid);
        items.push({
          uid: tenantUid,
          displayName: ou.displayName ?? 'Responsável',
          email: ou.email ?? null,
          role: 'owner'
        });
      } catch {
        items.push({ uid: tenantUid, displayName: 'Responsável', email: null, role: 'owner' });
      }

      const snap = await adminApp
        .firestore()
        .collection('userWorkspaceLinks')
        .where('ownerUid', '==', tenantUid)
        .get();

      const staffDraft: Array<{ uid: string; linkedAtIso: string }> = [];
      snap.forEach((docSnap) => {
        const id = docSnap.id;
        if (id === tenantUid) return;
        const d = docSnap.data();
        const linkedAtIso =
          d.linkedAt instanceof Timestamp ? d.linkedAt.toDate().toISOString() : typeof d.linkedAt === 'string' ? d.linkedAt : '';
        staffDraft.push({ uid: id, linkedAtIso });
      });

      staffDraft.sort((a, b) => {
        const la = a.linkedAtIso.slice(0, 19);
        const lb = b.linkedAtIso.slice(0, 19);
        return lb.localeCompare(la);
      });

      staffDraft.forEach((s) => {
        items.push({ uid: s.uid, displayName: null, email: null, role: 'staff' });
      });

      await Promise.all(
        items.slice(1).map(async (row) => {
          try {
            const u = await auth.getUser(row.uid);
            row.displayName = row.displayName || u.displayName || null;
            row.email = u.email ?? row.email ?? null;
          } catch {
            /* conta apagada */
          }
        })
      );

      return res.json({ ok: true, items });
    } catch (e) {
      console.error('[workspace/teammates]', e);
      return res.status(400).json({ ok: false, error: 'Token inválido.' });
    }
  });

  /** Mapa conversa → UID de quem assumiu (para o dono na UI). Membro da equipa pode ler o próprio snapshot filtrado já vem no socket. */
  app.get('/api/workspace/inbox-assignments', async (req: Request, res: Response) => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin não configurado no servidor.' });
    }
    const token = parseBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer.' });
    }
    try {
      const { tenantUid, authUid } = await resolveWorkspaceParticipant(adminApp, token);
      if (authUid !== tenantUid) {
        return res.status(403).json({ ok: false, error: 'Apenas o responsável pode ver todas as atribuições.' });
      }
      await ensureAssignmentsLoaded(tenantUid).catch(() => undefined);
      return res.json({ ok: true, assignments: assignmentsSnapshotForTenant(tenantUid) });
    } catch (e) {
      console.error('[workspace/inbox-assignments]', e);
      return res.status(400).json({ ok: false, error: 'Token inválido.' });
    }
  });

  /** Avaliações enviadas pelos clientes (link público WhatsApp after inbox finish). Dono ou equipa. */
  app.get('/api/workspace/inbox-client-feedback', async (req: Request, res: Response) => {
    const token = parseBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer.' });
    }
    const limitRaw = Number(req.query.limit ?? 80);
    const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 80));

    const pool = vpsAuthEnabled() ? getZapmassPool() : null;
    if (pool) {
      try {
        const principal = await resolveAuthPrincipal(token);
        if (!principal) {
          return res.status(401).json({ ok: false, error: 'Token inválido.' });
        }
        const r = await pool.query<{
          id: string;
          conversation_id: string;
          rating: number | null;
          comment: string | null;
          created_at: Date;
        }>(
          `SELECT id::text, conversation_id, rating, comment, created_at
           FROM zapmass.inbox_attendance_feedback
           WHERE tenant_id = $1::uuid
             AND COALESCE(trim(actor_subject_id), '') = ''
           ORDER BY created_at DESC
           LIMIT $2`,
          [principal.tenantUid, limit]
        );
        const items = r.rows.map((row) => ({
          id: row.id,
          conversationId: row.conversation_id,
          rating: typeof row.rating === 'number' ? row.rating : null,
          comment: row.comment,
          source: 'whatsapp_link',
          createdAt: row.created_at.toISOString()
        }));
        return res.json({ ok: true, items });
      } catch (e) {
        console.error('[workspace/inbox-client-feedback vps]', e);
        return res.status(503).json({ ok: false, error: 'Postgres indisponível.' });
      }
    }

    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.json({ ok: true, items: [] });
    }
    try {
      const { tenantUid } = await resolveWorkspaceParticipant(adminApp, token);
      const snap = await adminApp
        .firestore()
        .collection('users')
        .doc(tenantUid)
        .collection('inboxClientAttendanceFeedback')
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      const items = snap.docs.map((d) => {
        const data = d.data();
        const createdAtRaw = data.createdAt as Timestamp | undefined;
        let createdAtIso: string | null = null;
        if (createdAtRaw instanceof Timestamp) {
          createdAtIso = createdAtRaw.toDate().toISOString();
        }
        return {
          id: d.id,
          conversationId: typeof data.conversationId === 'string' ? data.conversationId : '',
          rating: typeof data.rating === 'number' ? data.rating : null,
          comment: typeof data.comment === 'string' ? data.comment : null,
          source:
            typeof data.source === 'string' && data.source.trim().length > 0
              ? String(data.source).trim()
              : 'whatsapp_link',
          createdAt: createdAtIso
        };
      });
      return res.json({ ok: true, items });
    } catch (e) {
      console.error('[workspace/inbox-client-feedback]', e);
      return res.status(400).json({ ok: false, error: 'Token inválido ou falha ao ler avaliações.' });
    }
  });

  /** Funcionário (ou dono) assume uma conversa; persiste em Firestore e reemite lista. */
  app.post('/api/workspace/inbox-claim', async (req: Request, res: Response) => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin não configurado no servidor.' });
    }
    const token = parseBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer.' });
    }
    const conversationId =
      typeof (req.body as { conversationId?: unknown })?.conversationId === 'string'
        ? String((req.body as { conversationId?: string }).conversationId).trim()
        : '';
    if (!conversationId) {
      return res.status(400).json({ ok: false, error: 'conversationId é obrigatório.' });
    }
    try {
      const { tenantUid, authUid } = await resolveWorkspaceParticipant(adminApp, token);
      const conv = getConversations().find((c) => c.id === conversationId);
      if (
        !conv ||
        !ownsConnectionForUid(tenantUid, conv.connectionId, resolveConnectionOwnerUid(conv.connectionId))
      ) {
        return res.status(403).json({ ok: false, error: 'Conversa não encontrada neste workspace.' });
      }
      const r = await inboxClaimConversation(tenantUid, authUid, conversationId, conv);
      if (r.ok === false) {
        if (r.code === 'ALREADY_CLAIMED') {
          return res.status(409).json({ ok: false, error: 'Outro utilizador já assumiu esta conversa.' });
        }
        return res.status(500).json({ ok: false, error: 'Serviço temporariamente indisponível.' });
      }
      broadcastConversationsUpdate();
      return res.json({ ok: true });
    } catch (e) {
      console.error('[workspace/inbox-claim]', e);
      return res.status(400).json({ ok: false, error: 'Falha ao assumir conversa.' });
    }
  });

  /** Direcionar atendimento a outro membro (responsável ou quem já tem a conversa assumida). */
  app.post('/api/workspace/inbox-transfer', async (req: Request, res: Response) => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin não configurado no servidor.' });
    }
    const token = parseBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer.' });
    }
    const conversationId =
      typeof (req.body as { conversationId?: unknown })?.conversationId === 'string'
        ? String((req.body as { conversationId?: string }).conversationId).trim()
        : '';
    const targetAuthUid =
      typeof (req.body as { targetAuthUid?: unknown })?.targetAuthUid === 'string'
        ? String((req.body as { targetAuthUid?: string }).targetAuthUid).trim()
        : '';
    if (!conversationId || !targetAuthUid) {
      return res.status(400).json({ ok: false, error: 'conversationId e targetAuthUid são obrigatórios.' });
    }
    try {
      const { tenantUid, authUid } = await resolveWorkspaceParticipant(adminApp, token);
      const conv = getConversations().find((c) => c.id === conversationId);
      if (
        !conv ||
        !ownsConnectionForUid(tenantUid, conv.connectionId, resolveConnectionOwnerUid(conv.connectionId))
      ) {
        return res.status(403).json({ ok: false, error: 'Conversa não encontrada neste workspace.' });
      }
      const isOwner = authUid === tenantUid;
      const r = await inboxTransferConversation(
        tenantUid,
        authUid,
        isOwner,
        conversationId,
        targetAuthUid,
        conv
      );
      if (r.ok === false) {
        const map403: Record<string, string> = {
          TARGET_NOT_IN_WORKSPACE: 'O destinatário não pertence a esta workspace.',
          NOT_YOUR_CLAIM: 'Só pode transferir conversas que você assumiu.',
          NOT_CLAIMED: 'Ninguém assumiu esta conversa.'
        };
        if (map403[r.code]) {
          return res.status(r.code === 'NOT_CLAIMED' ? 409 : 403).json({ ok: false, error: map403[r.code] });
        }
        if (r.code === 'INVALID_TARGET') {
          return res.status(400).json({ ok: false, error: 'Destinatário inválido.' });
        }
        return res.status(500).json({ ok: false, error: 'Serviço temporariamente indisponível.' });
      }
      broadcastConversationsUpdate();
      return res.json({ ok: true });
    } catch (e) {
      console.error('[workspace/inbox-transfer]', e);
      return res.status(400).json({ ok: false, error: 'Falha ao transferir.' });
    }
  });

  /** Libertação + pesquisa interna opcional + envio opcional ao cliente (WhatsApp com link público). */
  app.post('/api/workspace/inbox-finish', async (req: Request, res: Response) => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin não configurado no servidor.' });
    }
    const token = parseBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer.' });
    }
    const body = req.body as {
      conversationId?: unknown;
      skipSurvey?: unknown;
      rating?: unknown;
      comment?: unknown;
      sendClientSurvey?: unknown;
    };
    const conversationId = typeof body.conversationId === 'string' ? String(body.conversationId).trim() : '';
    const skipSurvey = Boolean(body.skipSurvey === true || body.skipSurvey === 'true' || body.skipSurvey === 1);
    let ratingNum: number | null = null;
    if (typeof body.rating === 'number' && body.rating >= 1 && body.rating <= 5) ratingNum = body.rating;
    if (typeof body.rating === 'string' && /^\d$/.test(body.rating)) {
      const n = Number(body.rating);
      if (n >= 1 && n <= 5) ratingNum = n;
    }
    const comment = typeof body.comment === 'string' ? body.comment : '';
    const sendClientSurvey = Boolean(
      body.sendClientSurvey === true ||
        body.sendClientSurvey === 'true' ||
        body.sendClientSurvey === 1
    );
    if (!conversationId) {
      return res.status(400).json({ ok: false, error: 'conversationId é obrigatório.' });
    }
    try {
      const { tenantUid, authUid } = await resolveWorkspaceParticipant(adminApp, token);
      const conv = getConversations().find((c) => c.id === conversationId);
      if (
        !conv ||
        !ownsConnectionForUid(tenantUid, conv.connectionId, resolveConnectionOwnerUid(conv.connectionId))
      ) {
        return res.status(403).json({ ok: false, error: 'Conversa não encontrada neste workspace.' });
      }
      const isOwner = authUid === tenantUid;
      const r = await inboxFinishConversation(tenantUid, authUid, conversationId, isOwner, {
        skipped: skipSurvey,
        rating: ratingNum,
        comment
      });
      if (r.ok === false) {
        if (r.code === 'NOT_CLAIMED') {
          return res.status(409).json({ ok: false, error: 'Ninguém está com esta conversa assumida.' });
        }
        if (r.code === 'NOT_YOUR_CLAIM') {
          return res.status(403).json({ ok: false, error: 'Só pode finalizar libertação das conversas que você assumiu.' });
        }
        return res.status(500).json({ ok: false, error: 'Serviço temporariamente indisponível.' });
      }
      broadcastConversationsUpdate();

      let clientSurveySent = false;
      let clientSurveyError: string | undefined;
      if (sendClientSurvey) {
        const origin = getSurveyLinksBaseOrigin();
        if (!origin) {
          clientSurveyError =
            'Link ao cliente não enviado: defina PUBLIC_APP_URL na API ou inclua a URL pública do site em ALLOWED_ORIGINS (ex.: https://app.seudominio.com); no Docker Swarm reponha o stack após editar .env.';
        } else {
          try {
            const db = adminApp.firestore();
            const token = await createPublicSurveyInvite(db, tenantUid, conversationId, conv.connectionId);
            const url = buildClientSurveyUrl(origin, token);
            const text = whatsappSurveyMessageBody(url);
            await submitSendMessage(conversationId, text, tenantUid);
            clientSurveySent = true;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('[workspace/inbox-finish] sendClientSurvey', msg);
            clientSurveyError = 'Não foi possível enviar a mensagem ao cliente (WhatsApp). A conversa foi libertada.';
          }
        }
      }

      return res.json({ ok: true, clientSurveySent, ...(clientSurveyError ? { clientSurveyError } : {}) });
    } catch (e) {
      console.error('[workspace/inbox-finish]', e);
      return res.status(400).json({ ok: false, error: 'Falha ao finalizar.' });
    }
  });

  /** Libertar conversa para a equipa (sem fluxo da pesquisa). Dono pode libertar qualquer uma. */
  app.delete('/api/workspace/inbox-claim/:conversationId', async (req: Request, res: Response) => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin não configurado no servidor.' });
    }
    const token = parseBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer.' });
    }
    const conversationId = String(req.params.conversationId || '').trim();
    if (!conversationId) {
      return res.status(400).json({ ok: false, error: 'conversationId inválido.' });
    }
    try {
      const { tenantUid, authUid } = await resolveWorkspaceParticipant(adminApp, token);
      const conv = getConversations().find((c) => c.id === conversationId);
      if (
        !conv ||
        !ownsConnectionForUid(tenantUid, conv.connectionId, resolveConnectionOwnerUid(conv.connectionId))
      ) {
        return res.status(403).json({ ok: false, error: 'Conversa não encontrada neste workspace.' });
      }
      const isOwner = authUid === tenantUid;
      const r = await inboxReleaseConversation(tenantUid, authUid, conversationId, isOwner);
      if (r.ok === false) {
        if (r.code === 'NOT_YOUR_CLAIM') {
          return res.status(403).json({ ok: false, error: 'Só pode libertar conversas que você assumiu.' });
        }
        return res.status(500).json({ ok: false, error: 'Serviço temporariamente indisponível.' });
      }
      broadcastConversationsUpdate();
      return res.json({ ok: true });
    } catch (e) {
      console.error('[workspace/inbox-claim DELETE]', e);
      return res.status(400).json({ ok: false, error: 'Falha ao libertar conversa.' });
    }
  });
}
