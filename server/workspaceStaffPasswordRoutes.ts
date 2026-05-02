/**
 * Funcionários com login por nome de usuário + senha na conta do gestor (Firebase Auth + vínculo userWorkspaceLinks).
 * Limite de funcionários com senha: getMaxStaffPasswordAccounts() — padrão 10, env MAX_STAFF_PASSWORD_ACCOUNTS (1–50).
 *
 * Requisito Firebase: Authentication → métodos → ativar «E-mail/senha» (o REST Identity Toolkit só autentica se estiver ativo).
 * Chave: use FIREBASE_WEB_API_KEY igual à Web API Key do projeto; se falhar só no servidor, confira restrições da chave no Google Cloud Console.
 */

import type { Express, Request, Response } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { staffSignInLimiter } from './httpRateLimit.js';

/**
 * Apenas desenvolvimento: nunca usar em produção multi-tenant.
 * Em produção é obrigatório FIREBASE_WEB_API_KEY (ou VITE_FIREBASE_API_KEY no .env do servidor).
 */
const FALLBACK_FIREBASE_WEB_API_KEY_DEV = 'AIzaSyAa-a8MMECStZgKxxELeLSJT7JpJOKMJZw';

export const FIREBASE_WEB_API_KEY_MISSING = 'FIREBASE_WEB_API_KEY_MISSING';

/** Limite efectivo por instalação — override com MAX_STAFF_PASSWORD_ACCOUNTS no .env da API (1 a 50; default 10). */
export function getMaxStaffPasswordAccounts(): number {
  const raw = process.env.MAX_STAFF_PASSWORD_ACCOUNTS ?? '10';
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(50, Math.floor(n)));
}

export function resolveFirebaseWebApiKey():
  | { ok: true; key: string }
  | { ok: false; code: typeof FIREBASE_WEB_API_KEY_MISSING } {
  const fromEnv =
    process.env.FIREBASE_WEB_API_KEY?.trim() || process.env.VITE_FIREBASE_API_KEY?.trim();
  if (fromEnv) return { ok: true, key: fromEnv };
  if (process.env.NODE_ENV === 'production') {
    return { ok: false, code: FIREBASE_WEB_API_KEY_MISSING };
  }
  return { ok: true, key: FALLBACK_FIREBASE_WEB_API_KEY_DEV };
}

/** @deprecated Prefer resolveFirebaseWebApiKey em código novo */
export function getFirebaseWebApiKey(): string {
  const r = resolveFirebaseWebApiKey();
  if (!r.ok) throw new Error(FIREBASE_WEB_API_KEY_MISSING);
  return r.key;
}

/** Slug estável como id do documento: [a-z0-9_] 3–28 caracteres. */
export function sanitizeLoginSlug(raw: string): string | null {
  const x = raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (x.length < 3 || x.length > 28) return null;
  return x;
}

/**
 * Email sintético único por conta de gestor + slug (só servidor + Firebase Auth).
 */
export function syntheticStaffEmail(ownerUid: string, loginSlug: string): string {
  return `zapm.staff.${ownerUid}.${loginSlug}@zapflow25.firebaseapp.com`;
}

function parseBearer(req: Request): string | null {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

/** Verifica se o token é um utilizador proprietário da conta principal (sem vínculo a outro workspace). */
async function assertOwnerBearer(adminApp: ReturnType<typeof getFirebaseAdmin>, token: string) {
  const decoded = await getAuth(adminApp!).verifyIdToken(token);
  const uid = decoded.uid;
  const db = adminApp!.firestore();
  const linkSnap = await db.collection('userWorkspaceLinks').doc(uid).get();
  const ou = linkSnap.exists ? linkSnap.data()?.ownerUid : null;
  const isStaff = typeof ou === 'string' && ou.trim().length > 0 && ou !== uid;
  if (isStaff) {
    throw new Error('NOT_OWNER');
  }
  return { uid, db };
}

/**
 * Converte mensagem do Identity Toolkit (REST) em código interno para texto ao utilizador.
 * Ver: https://firebase.google.com/docs/reference/rest/auth — error.message costuma ser o código.
 */
function mapIdentityToolkitError(rawMessage: string): string {
  const msg = String(rawMessage || '').trim();
  const head = msg.split(' : ')[0]?.trim() || msg;
  const upper = head.toUpperCase();

  const direct: Record<string, string> = {
    EMAIL_NOT_FOUND: 'EMAIL_AUTH',
    INVALID_PASSWORD: 'WRONG_PASSWORD',
    INVALID_LOGIN_CREDENTIALS: 'WRONG_PASSWORD',
    USER_DISABLED: 'USER_DISABLED',
    OPERATION_NOT_ALLOWED: 'OPERATION_NOT_ALLOWED',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'TOO_MANY_ATTEMPTS'
  };
  if (direct[upper]) return direct[upper];

  const ml = msg.toLowerCase();
  if (ml.includes('api_key') && ml.includes('referrer')) return 'API_KEY_REFERRER';
  if (ml.includes('api_key') && ml.includes('ip')) return 'API_KEY_IP';
  if (ml.includes('referer') && ml.includes('blocked')) return 'API_KEY_REFERRER';
  if (upper === 'INVALID_EMAIL') return 'EMAIL_AUTH';

  console.warn('[staff/sign-in] Firebase Identity Toolkit (não mapeado):', head.slice(0, 160));
  return 'AUTH_FAILED';
}

async function identityToolkitSignInWithPassword(email: string, password: string): Promise<{ localId: string }> {
  const keyRes = resolveFirebaseWebApiKey();
  if (!keyRes.ok) {
    throw new Error(FIREBASE_WEB_API_KEY_MISSING);
  }
  const key = keyRes.key;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    }
  );
  const body = (await res.json()) as {
    localId?: string;
    error?: { message?: string };
  };
  if (!res.ok || !body.localId) {
    const raw = String(body.error?.message || '');
    throw new Error(mapIdentityToolkitError(raw));
  }
  return { localId: body.localId };
}

async function countActiveStaff(db: Firestore, ownerUid: string): Promise<number> {
  const col = db.collection('users').doc(ownerUid).collection('staffPasswordUsers');
  const snap = await col.get();
  let n = 0;
  snap.forEach((doc) => {
    const r = doc.data()?.revokedAt;
    if (r == null) n += 1;
  });
  return n;
}

export function registerWorkspaceStaffPasswordRoutes(app: Express): void {
  /**
   * Login de funcionário (público). Devolve customToken para signInWithCustomToken no cliente.
   * Body: { managerEmail, loginName, password }
   */
  app.post('/api/workspace/staff/sign-in', staffSignInLimiter, async (req: Request, res: Response) => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin não configurado no servidor.' });
    }
    const body = req.body as { managerEmail?: unknown; loginName?: unknown; password?: unknown };
    const managerEmail =
      typeof body.managerEmail === 'string' ? body.managerEmail.trim().toLowerCase() : '';
    const loginName = typeof body.loginName === 'string' ? body.loginName : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const slug = sanitizeLoginSlug(loginName);
    if (!managerEmail || !managerEmail.includes('@') || !slug || password.length < 8) {
      return res.status(400).json({
        ok: false,
        error: 'Informe o e-mail do gestor, o nome de usuário e a senha (mínimo 8 caracteres).'
      });
    }
    try {
      const ownerRecord = await getAuth(adminApp).getUserByEmail(managerEmail);
      const ownerUid = ownerRecord.uid;
      const email = syntheticStaffEmail(ownerUid, slug);
      let localId: string;
      try {
        const r = await identityToolkitSignInWithPassword(email, password);
        localId = r.localId;
      } catch (ie: unknown) {
        if (ie instanceof Error && ie.message === FIREBASE_WEB_API_KEY_MISSING) {
          return res.status(503).json({
            ok: false,
            error: 'Servidor sem FIREBASE_WEB_API_KEY. Configure no .env da API para login de funcionários.'
          });
        }
        const c = ie instanceof Error ? ie.message : 'AUTH_FAILED';
        const pt: Record<string, string> = {
          EMAIL_AUTH:
            'E-mail do gestor ou nome de usuário não encontrado. Confirme os dados ou peça ao gestor para recriar o acesso.',
          WRONG_PASSWORD: 'Senha incorreta.',
          USER_DISABLED: 'Este acesso foi desativado. Fale com o gestor.',
          OPERATION_NOT_ALLOWED:
            'Login por e-mail/senha está desativado no projeto Firebase. Peça ao gestor para ativar «E-mail/senha» em Authentication → Sign-in method.',
          TOO_MANY_ATTEMPTS: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
          API_KEY_REFERRER:
            'A Web API Key do Firebase bloqueia pedidos do servidor. No Google Cloud → Credenciais → editar a chave → restrições de pedido da API: inclua Identity Toolkit ou use «Nenhuma» para testar.',
          API_KEY_IP:
            'A Web API Key do Firebase bloqueia o IP deste servidor. Ajuste as restrições de IP da chave no Google Cloud ou permita o IP da VPS.',
          AUTH_FAILED: 'Não foi possível entrar. Verifique usuário e senha.'
        };
        return res.status(401).json({ ok: false, error: pt[c] || pt.AUTH_FAILED });
      }
      const db = adminApp.firestore();
      const metaRef = db.collection('users').doc(ownerUid).collection('staffPasswordUsers').doc(slug);
      const meta = await metaRef.get();
      if (!meta.exists) {
        return res.status(403).json({ ok: false, error: 'Acesso não encontrado nesta conta.' });
      }
      const data = meta.data()!;
      const staffAuthUid = typeof data.staffAuthUid === 'string' ? data.staffAuthUid : '';
      if (staffAuthUid !== localId) {
        return res.status(403).json({ ok: false, error: 'Inconsistência de conta — peça novo acesso ao gestor.' });
      }
      if (data.revokedAt != null) {
        return res.status(403).json({ ok: false, error: 'Este acesso foi revogado.' });
      }
      const linkRef = db.collection('userWorkspaceLinks').doc(localId);
      const linkSnap = await linkRef.get();
      const linkOwner =
        linkSnap.exists && typeof linkSnap.data()?.ownerUid === 'string' ? linkSnap.data()!.ownerUid : null;
      if (linkOwner !== ownerUid) {
        return res.status(403).json({ ok: false, error: 'Vínculo inválido. Peça ajuda ao gestor.' });
      }
      const customToken = await getAuth(adminApp).createCustomToken(localId, {
        staffWorkspace: true,
        ownerUid
      });
      return res.json({ ok: true, customToken });
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'auth/user-not-found') {
        return res.status(404).json({ ok: false, error: 'E-mail do gestor não encontrado.' });
      }
      console.error('[workspace/staff/sign-in]', e);
      return res.status(400).json({ ok: false, error: 'Não foi possível validar os dados.' });
    }
  });

  /** Lista funcionários com senha (dono da conta). */
  app.get('/api/workspace/staff-password-users', async (req: Request, res: Response) => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin não configurado no servidor.' });
    }
    const token = parseBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer.' });
    }
    try {
      const { uid: ownerUid, db } = await assertOwnerBearer(adminApp, token);
      const snap = await db.collection('users').doc(ownerUid).collection('staffPasswordUsers').get();
      const itemsUnsorted: Array<{
        loginSlug: string;
        displayName: string;
        staffAuthUid: string;
        createdAtMs: number;
        createdAt: string | null;
        revoked: boolean;
      }> = [];
      snap.forEach((doc) => {
        const d = doc.data() || {};
        const ct = d.createdAt instanceof Timestamp ? d.createdAt.toDate().toISOString() : typeof d.createdAt === 'string' ? d.createdAt : null;
        const createdAtMs =
          d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : ct ? Date.parse(ct) || 0 : 0;
        itemsUnsorted.push({
          loginSlug: doc.id,
          displayName: typeof d.displayName === 'string' ? d.displayName : '',
          staffAuthUid: typeof d.staffAuthUid === 'string' ? d.staffAuthUid : '',
          createdAtMs,
          createdAt: ct,
          revoked: d.revokedAt != null
        });
      });
      itemsUnsorted.sort((a, b) => b.createdAtMs - a.createdAtMs);
      const items = itemsUnsorted.map(({ createdAtMs: _omit, ...row }) => ({
        loginSlug: row.loginSlug,
        displayName: row.displayName,
        staffAuthUid: row.staffAuthUid,
        createdAt: row.createdAt,
        revoked: row.revoked
      }));
      const cap = getMaxStaffPasswordAccounts();
      return res.json({ ok: true, items, max: cap });
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'NOT_OWNER') {
        return res.status(403).json({ ok: false, error: 'Apenas o administrador da conta pode ver esta lista.' });
      }
      console.error('[workspace/staff-password-users GET]', e);
      return res.status(400).json({ ok: false, error: 'Falha ao listar.' });
    }
  });

  /** Cria funcionário com nome de usuário + senha. */
  app.post('/api/workspace/staff-password-users', async (req: Request, res: Response) => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin não configurado no servidor.' });
    }
    const token = parseBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer.' });
    }
    const body = req.body as { displayName?: unknown; loginName?: unknown; password?: unknown };
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 80) : '';
    const loginName = typeof body.loginName === 'string' ? body.loginName : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const slug = sanitizeLoginSlug(loginName);
    if (!slug) {
      return res.status(400).json({
        ok: false,
        error: 'Nome de usuário: 3 a 28 caracteres, só letras minúsculas, números e sublinhado (_).'
      });
    }
    if (displayName.length < 2) {
      return res.status(400).json({ ok: false, error: 'Informe o nome da pessoa (para identificar no painel).' });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: 'A senha deve ter pelo menos 8 caracteres.' });
    }

    try {
      const { uid: ownerUid, db } = await assertOwnerBearer(adminApp, token);
      const metaRef = db.collection('users').doc(ownerUid).collection('staffPasswordUsers').doc(slug);

      const cap = getMaxStaffPasswordAccounts();
      const active = await countActiveStaff(db, ownerUid);
      if (active >= cap) {
        return res.status(400).json({
          ok: false,
          error: `Limite de ${cap} funcionários com senha atingido. Revogue um acesso antes.`
        });
      }

      const existing = await metaRef.get();
      if (existing.exists && existing.data()?.revokedAt == null) {
        return res.status(400).json({ ok: false, error: 'Já existe um usuário ativo com este nome de login.' });
      }

      const email = syntheticStaffEmail(ownerUid, slug);

      const auth = getAuth(adminApp);

      /** Se existiu revogado, apaga utilizador Firebase antigo se ainda existir pelo mesmo slug reutilizado. */
      let userRecord;
      try {
        userRecord = await auth.createUser({
          email,
          password,
          displayName
        });
      } catch (ce: unknown) {
        const code = typeof ce === 'object' && ce && 'code' in ce ? String((ce as { code?: string }).code) : '';
        if (code === 'auth/email-already-exists') {
          /** Reutilização: atualiza palavra-passe deste utilizador sintético. */
          try {
            const byEmail = await auth.getUserByEmail(email);
            await auth.updateUser(byEmail.uid, { password, displayName: displayName || undefined, disabled: false });
            userRecord = await auth.getUser(byEmail.uid);
          } catch {
            return res.status(400).json({
              ok: false,
              error: 'Este nome de usuário já está registado mas não pode ser recriado automaticamente.'
            });
          }
        } else {
          throw ce;
        }
      }

      const staffUid = userRecord.uid;
      await db.collection('userWorkspaceLinks').doc(staffUid).set({
        ownerUid,
        linkedAt: FieldValue.serverTimestamp(),
        staffLoginSlug: slug
      });
      await metaRef.set({
        staffAuthUid: staffUid,
        displayName,
        syntheticEmail: email,
        createdAt: FieldValue.serverTimestamp(),
        revokedAt: null
      });

      return res.json({
        ok: true,
        loginSlug: slug,
        syntheticEmail: email /** opcional ao gestor; login na landing só precisa email do gestor + slug + senha */,
        staffAuthUid: staffUid
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'NOT_OWNER') {
        return res.status(403).json({ ok: false, error: 'Apenas o administrador principal pode criar usuários por senha.' });
      }
      if (e instanceof Error && e.message === 'LIMIT') {
        return res.status(400).json({ ok: false, error: `Limite de ${getMaxStaffPasswordAccounts()} funcionários com senha.` });
      }
      console.error('[workspace/staff-password-users POST]', e);
      return res.status(400).json({ ok: false, error: 'Não foi possível criar o acesso.' });
    }
  });

  /**
   * Revoga acesso por senha, ou remove permanentemente da lista se já revogado (?purge=true).
   */
  app.delete('/api/workspace/staff-password-users/:staffAuthUid', async (req: Request, res: Response) => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin não configurado no servidor.' });
    }
    const token = parseBearer(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Envie Authorization: Bearer.' });
    }
    const staffAuthUid = String(req.params.staffAuthUid || '').trim();
    if (!staffAuthUid || staffAuthUid.length < 8) {
      return res.status(400).json({ ok: false, error: 'Identificador inválido.' });
    }
    const purge =
      String(req.query.purge ?? '').toLowerCase() === 'true' || req.query.purge === '1';
    try {
      const { uid: ownerUid, db } = await assertOwnerBearer(adminApp, token);
      const col = db.collection('users').doc(ownerUid).collection('staffPasswordUsers');
      const qs = await col.where('staffAuthUid', '==', staffAuthUid).limit(1).get();
      if (qs.empty) {
        return res.status(404).json({ ok: false, error: 'Membro não encontrado neste workspace.' });
      }
      const doc = qs.docs[0];
      const auth = getAuth(adminApp);

      if (purge) {
        const revokedAt = doc.data()?.revokedAt;
        if (revokedAt == null) {
          return res.status(400).json({
            ok: false,
            error: 'Primeiro revogue o acesso; só depois pode apagar da lista.'
          });
        }
        try {
          await auth.deleteUser(staffAuthUid);
        } catch {
          /* já removido ou inexistente */
        }
        await db.collection('userWorkspaceLinks').doc(staffAuthUid).delete().catch(() => undefined);
        await doc.ref.delete();
        return res.json({ ok: true });
      }

      try {
        await auth.updateUser(staffAuthUid, { disabled: true });
      } catch {
        /* talvez já apagado */
      }
      await db.collection('userWorkspaceLinks').doc(staffAuthUid).delete().catch(() => undefined);
      await doc.ref.update({ revokedAt: FieldValue.serverTimestamp() });
      return res.json({ ok: true });
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'NOT_OWNER') {
        return res.status(403).json({ ok: false, error: 'Sem permissão.' });
      }
      console.error('[workspace/staff-password-users DELETE]', e);
      return res.status(400).json({ ok: false, error: purge ? 'Falha ao apagar.' : 'Falha ao revogar.' });
    }
  });
}
