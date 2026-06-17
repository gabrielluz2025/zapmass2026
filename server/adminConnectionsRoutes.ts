import type { Express, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { assertAdminFromBearer } from './adminAuth.js';
import { explainAdminForceRemoveBlock, isAdminForceRemoveAllowed } from './adminConnectionsPolicy.js';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import * as evolutionService from './evolutionService.js';
import * as waService from './whatsappService.js';
import { submitDeleteConnection } from './sessionControlPlane.js';
import { isLegacyConnectionId } from '../src/utils/connectionScope.js';

const useEvolutionEngine = () =>
  String(process.env.ZAPMASS_WHATSAPP_ENGINE || 'evolution').toLowerCase() === 'evolution';

function listConnectionsForAdmin() {
  return useEvolutionEngine() ? evolutionService.getConnections() : waService.getConnections();
}

function resolveMetadataOwnerUid(connectionId: string): string | null {
  if (useEvolutionEngine()) {
    return evolutionService.resolveConnectionOwnerUid(connectionId) ?? null;
  }
  const idx = connectionId.indexOf('__');
  return idx > 0 ? connectionId.slice(0, idx) : null;
}

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

    const raw = listConnectionsForAdmin();
    const uids = [
      ...new Set(
        raw
          .map((c) => resolveMetadataOwnerUid(c.id) ?? ownerFromConnectionId(c.id).ownerUid)
          .filter((x): x is string => Boolean(x))
      )
    ];

    const emailByUid = await resolveOwnerEmails(uids);

    const connections = raw.map((c) => {
      const { ownerUid: ownerFromId, localId } = ownerFromConnectionId(c.id);
      const metadataOwnerUid = resolveMetadataOwnerUid(c.id);
      const ownerUid = metadataOwnerUid ?? ownerFromId ?? c.ownerUid ?? null;
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
        legacyConnId: isLegacyConnectionId(c.id),
        orphan: isLegacyConnectionId(c.id) && !ownerUid,
        canRevoke,
        canRevokeReason: canRevoke ? null : explainAdminForceRemoveBlock(c)
      };
    });

    res.json({ ok: true, at: new Date().toISOString(), connections });
  });

  /** Diagnóstico de donos (conn_* legados) — use antes de corrigir vazamento entre tenants. */
  app.get('/api/admin/connections-ownership', async (req: Request, res: Response) => {
    const auth = await assertAdminFromBearer(req, res);
    if (!auth) return;

    if (!useEvolutionEngine()) {
      res.status(400).json({ ok: false, error: 'Disponível apenas com ZAPMASS_WHATSAPP_ENGINE=evolution.' });
      return;
    }

    await evolutionService.ensureConnectionsHydrated().catch(() => undefined);
    const raw = evolutionService.getConnections();
    const uids = [
      ...new Set(
        raw
          .map((c) => evolutionService.resolveConnectionOwnerUid(c.id))
          .filter((x): x is string => Boolean(x))
      )
    ];
    const emailByUid = await resolveOwnerEmails(uids);

    const byOwner = new Map<string, string[]>();
    const rows = raw.map((c) => {
      const ownerUid = evolutionService.resolveConnectionOwnerUid(c.id) ?? null;
      if (ownerUid) {
        const list = byOwner.get(ownerUid) ?? [];
        list.push(c.id);
        byOwner.set(ownerUid, list);
      }
      return {
        id: c.id,
        name: c.name,
        phoneNumber: c.phoneNumber,
        status: c.status,
        ownerUid,
        ownerEmail: ownerUid ? emailByUid.get(ownerUid) ?? null : null,
        legacyConnId: isLegacyConnectionId(c.id),
        orphan: isLegacyConnectionId(c.id) && !ownerUid
      };
    });

    const orphans = rows.filter((r) => r.orphan).map((r) => r.id);
    res.json({
      ok: true,
      at: new Date().toISOString(),
      total: rows.length,
      orphanCount: orphans.length,
      orphanIds: orphans,
      owners: [...byOwner.entries()].map(([uid, ids]) => ({
        ownerUid: uid,
        ownerEmail: emailByUid.get(uid) ?? null,
        connectionIds: ids
      })),
      connections: rows
    });
  });

  /** Reconciliação automática de donos (Patrícia → conta correta, etc.). */
  app.post('/api/admin/connections/auto-reconcile', async (req: Request, res: Response) => {
    const auth = await assertAdminFromBearer(req, res);
    if (!auth) return;

    if (!useEvolutionEngine()) {
      res.status(400).json({ ok: false, error: 'Disponível apenas com ZAPMASS_WHATSAPP_ENGINE=evolution.' });
      return;
    }

    const dryRun = req.query.dryRun === '1' || (req.body as { dryRun?: boolean })?.dryRun === true;
    const result = await evolutionService.autoReconcileConnectionOwners({ dryRun });
    res.json({ ok: result.ok, ...result, reconciledBy: auth.uid });
  });

  /** Reatribui ownerUid de canal legado (reparo manual pós vazamento). */
  app.post('/api/admin/connections/reassign-owner', async (req: Request, res: Response) => {
    const auth = await assertAdminFromBearer(req, res);
    if (!auth) return;

    if (!useEvolutionEngine()) {
      res.status(400).json({ ok: false, error: 'Disponível apenas com ZAPMASS_WHATSAPP_ENGINE=evolution.' });
      return;
    }

    const body = req.body as { id?: unknown; ownerUid?: unknown; priorOwnerUid?: unknown };
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    const ownerUid = typeof body.ownerUid === 'string' ? body.ownerUid.trim() : '';
    const priorOwnerUid =
      typeof body.priorOwnerUid === 'string' && body.priorOwnerUid.trim()
        ? body.priorOwnerUid.trim()
        : undefined;

    if (!id || !ownerUid) {
      res.status(400).json({ ok: false, error: 'Campos "id" e "ownerUid" são obrigatórios.' });
      return;
    }

    const result = await evolutionService.reassignConnectionOwnerAdmin(id, ownerUid, { priorOwnerUid });
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error, priorOwnerUid: result.priorOwnerUid });
      return;
    }

    res.json({
      ok: true,
      id,
      priorOwnerUid: result.priorOwnerUid ?? null,
      ownerUid: result.newOwnerUid ?? ownerUid,
      reassignedBy: auth.uid
    });
  });

  app.post('/api/admin/connections/revoke-pending', async (req: Request, res: Response) => {
    const auth = await assertAdminFromBearer(req, res);
    if (!auth) return;

    const id = typeof (req.body as { id?: unknown })?.id === 'string' ? (req.body as { id: string }).id.trim() : '';
    if (!id) {
      res.status(400).json({ ok: false, error: 'Campo "id" obrigatório.' });
      return;
    }

    const list = listConnectionsForAdmin();
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

    const list = listConnectionsForAdmin();
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
