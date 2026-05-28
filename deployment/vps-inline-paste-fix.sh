#!/usr/bin/env bash
# Cole ESTE SCRIPT INTEIRO no terminal da Hostinger (hPanel > Terminal), nao no PC.
# Corrige: canal open na Evolution mas 0 no painel ZapMass.
set -euo pipefail
cd /opt/zapmass

echo "==> Backup"
cp -a server/evolutionService.ts "server/evolutionService.ts.bak.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true

echo "==> connectionsSyncRoutes.ts"
cat > server/connectionsSyncRoutes.ts <<'TS'
import type { Express, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { filterByConnectionScope } from '../src/utils/connectionScope.js';
import { conversationsPayloadForViewer } from './conversationsEmit.js';
import * as evolutionService from './evolutionService.js';

function parseBearer(req: Request): string | null {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    return m ? m[1].trim() : null;
}

async function resolveTenantUid(idToken: string): Promise<string | null> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) return null;
    const decoded = await getAuth(adminApp).verifyIdToken(idToken);
    let tenantUid = decoded.uid;
    try {
        const lk = await adminApp.firestore().collection('userWorkspaceLinks').doc(decoded.uid).get();
        if (lk.exists) {
            const ou = lk.data()?.ownerUid;
            if (typeof ou === 'string' && ou.trim().length > 0) tenantUid = ou.trim();
        }
    } catch { /* ok */ }
    return tenantUid;
}

export function registerConnectionsSyncRoutes(app: Express): void {
    app.post('/api/connections/sync', async (req: Request, res: Response) => {
        try {
            const idToken = parseBearer(req);
            if (!idToken) return res.status(401).json({ ok: false, error: 'Bearer token obrigatorio' });
            const tenantUid = await resolveTenantUid(idToken);
            if (!tenantUid) return res.status(401).json({ ok: false, error: 'Token invalido' });
            const result = await evolutionService.syncConnectionsForOwner(tenantUid);
            const connections = filterByConnectionScope(tenantUid, result.connections);
            const conversations = conversationsPayloadForViewer(tenantUid, tenantUid, evolutionService.getConversations());
            return res.json({ ok: true, connections, conversationsCount: conversations.length, claimed: result.claimed, syncedChats: result.syncedChats });
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            console.error('[api/connections/sync]', message);
            return res.status(500).json({ ok: false, error: message });
        }
    });
}
TS

echo "==> connectionScope.ts (ownerUid em ids legados)"
python3 <<'PY'
from pathlib import Path
p = Path("src/utils/connectionScope.ts")
t = p.read_text(encoding="utf-8")
if "metadataOwnerUid" in t:
    print("connectionScope ja atualizado")
else:
    old = """export function ownsConnectionForUid(
  socketUid: string | null | undefined,
  connectionId: string
): boolean {
  if (!connectionId) return false;
  if (isLegacyConnectionId(connectionId)) {
    if (!strictConnectionScope()) return true;
    // Modo multi-tenant estrito: so sessao "anonima" (operador) ve o legado.
    return !socketUid || socketUid === 'anonymous';
  }

  const idx = connectionId.indexOf('__');
  if (idx <= 0) return false;

  const owner = connectionId.slice(0, idx);
  const uid = !socketUid || socketUid === 'anonymous' ? 'anonymous' : socketUid;

  if (uid === 'anonymous') return owner === 'anonymous';
  return owner === uid;
}"""
    new = """export function ownsConnectionForUid(
  socketUid: string | null | undefined,
  connectionId: string,
  metadataOwnerUid?: string | null
): boolean {
  if (!connectionId) return false;
  const uid = !socketUid || socketUid === 'anonymous' ? 'anonymous' : socketUid;
  const idx = connectionId.indexOf('__');
  if (idx > 0) {
    const owner = connectionId.slice(0, idx);
    if (uid === 'anonymous') return owner === 'anonymous';
    return owner === uid;
  }
  if (metadataOwnerUid) {
    if (uid === 'anonymous') return metadataOwnerUid === 'anonymous';
    return metadataOwnerUid === uid;
  }
  if (isLegacyConnectionId(connectionId)) {
    if (!strictConnectionScope()) return true;
    return !socketUid || socketUid === 'anonymous';
  }
  return false;
}"""
    if old not in t:
        raise SystemExit("connectionScope: padrao antigo nao encontrado — edite manualmente")
    t = t.replace(old, new, 1)
    t = t.replace(
        "    return ownsConnectionForUid(uid, key);",
        """    const meta = typeof (item as { ownerUid?: string }).ownerUid === 'string'
        ? (item as { ownerUid?: string }).ownerUid
        : undefined;
    return ownsConnectionForUid(uid, key, meta);""",
        1,
    )
    p.write_text(t, encoding="utf-8")
    print("OK connectionScope")
PY

echo "==> evolutionService.ts"
python3 <<'PY2'
from pathlib import Path
p = Path("server/evolutionService.ts")
t = p.read_text(encoding="utf-8")
if "syncConnectionsForOwner" in t:
    print("evolutionService ja tem sync")
    raise SystemExit(0)

if "filterByConnectionScope" not in t:
    t = t.replace(
        "import { createEvolutionChat, type EvolutionChatStore } from './evolutionChat.js';",
        "import { createEvolutionChat, type EvolutionChatStore } from './evolutionChat.js';\nimport { filterByConnectionScope } from '../src/utils/connectionScope.js';",
        1,
    )

if "ownerUid?: string;" not in t:
    t = t.replace(
        "interface EvolutionInstance {\n    instanceName: string;",
        "interface EvolutionInstance {\n    instanceName: string;",
    )
    t = t.replace(
        "    status: 'created' | 'connecting' | 'open' | 'close';\n    profilePicUrl",
        "    status: 'created' | 'connecting' | 'open' | 'close';\n    ownerUid?: string;\n    profilePicUrl",
        1,
    )

anchor = "function resolveInstanceName(raw: unknown): string {"
block = r'''
function resolveOwnerUid(connectionId: string): string | undefined {
    return ownerUidFromConnectionId(connectionId) || connections.get(connectionId)?.ownerUid;
}

export function listOrphanOpenConnectionIds(): string[] {
    const out: string[] = [];
    for (const [id, conn] of connections.entries()) {
        if (conn.status !== 'open') continue;
        if (ownerUidFromConnectionId(id)) continue;
        if (conn.ownerUid) continue;
        out.push(id);
    }
    return out;
}

export function assignConnectionOwner(connectionId: string, ownerUid: string): boolean {
    const uid = String(ownerUid || '').trim();
    if (!uid || uid === 'anonymous') return false;
    const conn = connections.get(connectionId);
    if (!conn) return false;
    if (conn.ownerUid && conn.ownerUid !== uid) return false;
    const fromId = ownerUidFromConnectionId(connectionId);
    if (fromId && fromId !== uid) return false;
    conn.ownerUid = uid;
    connections.set(connectionId, conn);
    publishOwnerEvent(uid, 'connections-update', filterByConnectionScope(uid, getConnections()));
    return true;
}

export async function syncConnectionsForOwner(ownerUid: string): Promise<{
    connections: import('./types.js').WhatsAppConnection[];
    claimed: string[];
    syncedChats: string[];
}> {
    const uid = String(ownerUid || '').trim();
    if (!uid || uid === 'anonymous') return { connections: [], claimed: [], syncedChats: [] };
    await hydrateInstancesFromEvolution();
    const claimed: string[] = [];
    for (const orphanId of listOrphanOpenConnectionIds()) {
        if (assignConnectionOwner(orphanId, uid)) claimed.push(orphanId);
    }
    const syncedChats: string[] = [];
    for (const [id, conn] of connections.entries()) {
        if (conn.status !== 'open') continue;
        if (resolveOwnerUid(id) !== uid) continue;
        await chatStore.syncChatsForConnection(id);
        syncedChats.push(id);
    }
    const { conversationsPayloadForViewer } = await import('./conversationsEmit.js');
    const scoped = filterByConnectionScope(uid, getConnections());
    publishOwnerEvent(uid, 'connections-update', scoped);
    publishOwnerEvent(uid, 'conversations-update', conversationsPayloadForViewer(uid, uid, chatStore.getConversations()));
    log('info', `syncConnectionsForOwner: ${scoped.length} canal(is), claimed=${claimed.join(',') || '-'}`);
    return { connections: scoped, claimed, syncedChats };
}

'''
if anchor not in t:
    raise SystemExit("anchor resolveInstanceName nao encontrado")
t = t.replace(anchor, block + anchor, 1)

# resolveOwnerUid in emit paths
t = t.replace("const ownerUid = ownerUidFromConnectionId(connectionId);", "const ownerUid = resolveOwnerUid(connectionId);")
t = t.replace("const ownerUid = ownerUidFromConnectionId(instance);", "const ownerUid = resolveOwnerUid(instance);")

# createConnectionInternal ownerUid
if "ownerUid: ownerUid || ownerUidFromConnectionId(id)" not in t:
    t = t.replace(
        "status: 'created',\n            ...(proxy?.host",
        "status: 'created',\n            ownerUid: ownerUid || ownerUidFromConnectionId(id),\n            ...(proxy?.host",
        1,
    )
if "createConnectionInternal(id, name, proxy)" in t:
    t = t.replace("createConnectionInternal(id, name, proxy)", "createConnectionInternal(id, name, proxy, ownerUid)")

if "async function createConnectionInternal(\n    id: string,\n    name: string,\n    proxy?: ConnectionProxyConfig\n):" in t:
    t = t.replace(
        "proxy?: ConnectionProxyConfig\n):",
        "proxy?: ConnectionProxyConfig,\n    ownerUid?: string\n):",
        1,
    )

if "ownerUid: resolveOwnerUid(id)," not in t and "name: conn.friendlyName || id," in t:
    t = t.replace(
        "            name: conn.friendlyName || id,\n            phoneNumber:",
        "            name: conn.friendlyName || id,\n            ownerUid: resolveOwnerUid(id),\n            phoneNumber:",
        1,
    )

if "ownerUid: existing?.ownerUid" not in t and "hydrateInstancesFromEvolution" in t:
    t = t.replace(
        "                status: mapEvolutionState(row.connectionStatus ?? row.state ?? row.status),\n                profilePicUrl:",
        "                status: mapEvolutionState(row.connectionStatus ?? row.state ?? row.status),\n                ownerUid: existing?.ownerUid || ownerUidFromConnectionId(instanceName),\n                profilePicUrl:",
        1,
    )

# open state sync chats to owner
old_open = """        void chatStore.syncChatsForConnection(instance);
    }
}"""
new_open = """        void (async () => {
            await chatStore.syncChatsForConnection(instance);
            const ou = resolveOwnerUid(instance);
            if (ou) {
                const { conversationsPayloadForViewer } = await import('./conversationsEmit.js');
                publishOwnerEvent(ou, 'conversations-update', conversationsPayloadForViewer(ou, ou, chatStore.getConversations()));
            }
        })();
    }
}"""
if old_open in t:
    t = t.replace(old_open, new_open, 1)

p.write_text(t, encoding="utf-8")
print("OK evolutionService sync")
PY2

echo "==> server.ts"
python3 <<'PY'
from pathlib import Path
p = Path("server/server.ts")
t = p.read_text(encoding="utf-8")
if "registerConnectionsSyncRoutes" not in t:
    t = t.replace(
        "import { registerProductSuggestionRoutes } from './productSuggestionRoutes.js';",
        "import { registerProductSuggestionRoutes } from './productSuggestionRoutes.js';\nimport { registerConnectionsSyncRoutes } from './connectionsSyncRoutes.js';",
        1,
    )
    t = t.replace(
        "registerProductSuggestionRoutes(app);",
        "registerProductSuggestionRoutes(app);\nregisterConnectionsSyncRoutes(app);",
        1,
    )
    p.write_text(t, encoding="utf-8")
    print("OK server register route")

# socket sync on connect
p = Path("server/server.ts")
t = p.read_text(encoding="utf-8")
needle = "    emitScopedConnections();\n    if (uid && uid !== 'anonymous') {"
if "syncConnectionsForOwner" in t and needle in t:
    print("server socket sync ja presente")
elif needle in t:
    repl = """    emitScopedConnections();
    if (uid && uid !== 'anonymous') {
      void evolutionService.syncConnectionsForOwner(uid).then((r) => {
        if (r.connections.length > 0 || r.claimed.length > 0) {
          userLog('socket:sync-connections', { channels: r.connections.length, claimed: r.claimed });
        }
        emitScopedConnections();
      });
    }
    if (false && uid && uid !== 'anonymous') {"""
    t = t.replace(needle, repl, 1)
    p.write_text(t, encoding="utf-8")
    print("OK server socket sync")
else:
    print("AVISO: ajuste socket sync manualmente em server.ts")
PY

echo "==> Verificar disco"
grep -c syncConnectionsForOwner server/evolutionService.ts
test -f server/connectionsSyncRoutes.ts && echo "connectionsSyncRoutes OK"

echo "==> Build + deploy"
docker build -t zapmass:latest .
docker service update --force --image zapmass:latest zapmass_api
sleep 35
CID=$(docker ps -q -f name=zapmass_api | head -1)
docker exec "$CID" grep -c syncConnectionsForOwner /app/server/evolutionService.ts
curl -sf http://127.0.0.1:3001/api/health && echo ""
echo "Ctrl+F5 em https://zap-mass.com"
