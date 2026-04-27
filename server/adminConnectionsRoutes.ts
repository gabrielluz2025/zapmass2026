import type { Express, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { assertAdminFromBearer } from './adminAuth.js';
import { explainAdminForceRemoveBlock, isAdminForceRemoveAllowed } from './adminConnectionsPolicy.js';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import * as waService from './whatsappService.js';
import { submitDeleteConnection } from './sessionControlPlane.js';

function ownerFromConnectionId(id: string): { ownerUid: string | null; localId: string } {
  const idx = id.indexOf('__');
  if (idx <= 0) return { ownerUid: null, localId: id };
  return { ownerUid: id.slice(0, idx), localId: id.slice(idx + 2) };
}

async function resolveOwnerEmails(
  uids: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const app = getFirebaseAdmin();
  if (!app || uids.length === 0) {
    return map;
  }
  const auth = getAuth();
  for (let i = 0; i < uids.length; i += 100) {
    const batch = uids.slice(i, i + 100);
    try {
      const res = await auth.getUsers(batch.map((uid) => ({ uid })));
      for (const u of res.users) {
        if (u.email) map.set(u.uid, u.email);
      }
    } catch (e) {
      console.warn('[admin connections] getUsers parcial:', e instanceof Error ? e.message : e);
    }
  }
  return map;
}

function assertCanForceRemove(
  res: Response,
  conn: import('./types.js').WhatsAppConnection
): boolean {
  if (isAdminForceRemoveAllowed(conn)) {
    return true;
  }
  res.status(400).json({ ok: false, error: explainAdminForceRemoveBlock(conn) });
  return false;
}

export function registerAdminConnectionsRoutes(app: Express): void {
  app.get('/api/admin/connections-overview', async (req: Request, res: Response) => {
    const auth = await assertAdminFromBearer(req, res);
    if (!auth) return;

    const raw = waService.getConnections();
    const uids = [...new Set(raw.map((c) => ownerFromConnectionId(c.id).ownerUid).filter((x): x is string => Boolean(x)))];

    const emailByUid = await resolveOwnerEmails(uids);

    const connections = raw.map((c) => {
      const { ownerUid, localId } = ownerFromConnectionId(c.id);
      const canRevoke = isAdminForceRemoveAllowed(c);
      return {
        id: c.id,
        localId,
        name: c.name,
        status: c.status,
        lastActivity: c.lastActivity,
        phoneNumber: c.phoneNumber,
        ownerUid,
        ownerEmail: ownerUid ? emailByUid.get(ownerUid) ?? null : null,
        canRevoke,
        canRevokeReason: canRevoke ? null : explainAdminForceRemoveBlock(c)
      };
    });

    res.json({ ok: true, at: new Date().toISOString(), connections });
  });

  app.post('/api/admin/connections/revoke-pending', async (req: Request, res: Response) => {
    const auth = await assertAdminFromBearer(req, res);
    if (!auth) return;

    const id = typeof (req.body as { id?: unknown })?.id === 'string' ? (req.body as { id: string }).id.trim() : '';
    if (!id) {
      res.status(400).json({ ok: false, error: 'Campo "id" obrigatório.' });
      return;
    }

    const list = waService.getConnections();
    const conn = list.find((c) => c.id === id);
    if (!conn) {
      res.status(404).json({ ok: false, error: 'Conexão não encontrada.' });
      return;
    }
    if (!assertCanForceRemove(res, conn)) {
      return;
    }

    try {
      await submitDeleteConnection(id, auth.uid);
      res.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao remover conexão';
      res.status(500).json({ ok: false, error: msg });
    }
  });

  app.post('/api/admin/connections/revoke-pending-bulk', async (req: Request, res: Response) => {
    const auth = await assertAdminFromBearer(req, res);
    if (!auth) return;

    const list = waService.getConnections();
    const targets = list.filter((c) => isAdminForceRemoveAllowed(c));
    const removed: string[] = [];
    const failures: { id: string; error: string }[] = [];

    for (const conn of targets) {
      try {
        await submitDeleteConnection(conn.id, auth.uid);
        removed.push(conn.id);
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        failures.push({ id: conn.id, error: err });
      }
    }

    res.json({
      ok: failures.length === 0 || removed.length > 0,
      removed: removed.length,
      removedIds: removed,
      failures
    });
  });
}
