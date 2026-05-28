# Colar na VPS (terminal Hostinger hPanel)

O PC nao consegue SCP (porta 22 timeout). Use o **terminal do navegador** na Hostinger.

Meta: `grep -c syncConnectionsForOwner server/evolutionService.ts` → **>= 1**

---

## Bloco 1

```bash
cd /opt/zapmass
cp -a server/evolutionService.ts server/evolutionService.ts.bak.$(date +%Y%m%d%H%M%S)
grep -n "ownerUidFromConnectionId\|resolveInstanceName" server/evolutionService.ts | head -8
```

---

## Bloco 2 — evolutionService.ts (cole este bloco inteiro)

```bash
python3 <<'PY'
from pathlib import Path
p = Path("server/evolutionService.ts")
t = p.read_text(encoding="utf-8")
if "syncConnectionsForOwner" in t:
    print("OK: ja existe syncConnectionsForOwner")
    raise SystemExit(0)

if "filterByConnectionScope" not in t:
    a = "import { createEvolutionChat, type EvolutionChatStore } from './evolutionChat.js';"
    b = a + "\nimport { filterByConnectionScope } from '../src/utils/connectionScope.js';"
    if a in t:
        t = t.replace(a, b, 1)
    else:
        t = "import { filterByConnectionScope } from '../src/utils/connectionScope.js';\n" + t

if "ownerUid?: string;" not in t:
    t = t.replace(
        "    status: 'created' | 'connecting' | 'open' | 'close';\n    profilePicUrl",
        "    status: 'created' | 'connecting' | 'open' | 'close';\n    ownerUid?: string;\n    profilePicUrl",
        1,
    )

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
    connections: WhatsAppConnection[];
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

anchors = [
    "function resolveInstanceName(raw: unknown): string {",
    "function ownerUidFromConnectionId(connectionId: string): string | undefined {",
]
inserted = False
for anchor in anchors:
    if anchor in t and block.strip() not in t:
        if anchor.startswith("function ownerUid"):
            idx = t.find(anchor)
            end = t.find("\nfunction ", idx + 10)
            if end < 0:
                end = t.find("\nfunction emit", idx + 10)
            if end > idx:
                t = t[:end] + "\n" + block + t[end:]
                inserted = True
                break
        else:
            t = t.replace(anchor, block + anchor, 1)
            inserted = True
            break
if not inserted:
    raise SystemExit("ERRO: nao achei anchor. Envie: grep -n ownerUid resolveInstance server/evolutionService.ts | head")

t = t.replace("const ownerUid = ownerUidFromConnectionId(connectionId);", "const ownerUid = resolveOwnerUid(connectionId);")
t = t.replace("const ownerUid = ownerUidFromConnectionId(instance);", "const ownerUid = resolveOwnerUid(instance);")

if "ownerUid: ownerUid || ownerUidFromConnectionId(id)" not in t:
    t = t.replace(
        "status: 'created',\n            ...(proxy?.host",
        "status: 'created',\n            ownerUid: ownerUid || ownerUidFromConnectionId(id),\n            ...(proxy?.host",
        1,
    )
if "createConnectionInternal(id, name, proxy)" in t and "createConnectionInternal(id, name, proxy, ownerUid)" not in t:
    t = t.replace("createConnectionInternal(id, name, proxy)", "createConnectionInternal(id, name, proxy, ownerUid)")
if "proxy?: ConnectionProxyConfig\n):" in t and "ownerUid?: string" not in t.split("createConnectionInternal")[1][:400]:
    t = t.replace(
        "    proxy?: ConnectionProxyConfig\n): Promise<{ qrCode?: string; error?: string }>",
        "    proxy?: ConnectionProxyConfig,\n    ownerUid?: string\n): Promise<{ qrCode?: string; error?: string }>",
        1,
    )
if "ownerUid: resolveOwnerUid(id)," not in t:
    t = t.replace(
        "            name: conn.friendlyName || id,\n            phoneNumber:",
        "            name: conn.friendlyName || id,\n            ownerUid: resolveOwnerUid(id),\n            phoneNumber:",
        1,
    )

p.write_text(t, encoding="utf-8")
print("OK evolutionService — syncConnectionsForOwner inserido")
print("grep count:", t.count("syncConnectionsForOwner"))
PY
grep -c syncConnectionsForOwner server/evolutionService.ts
```

Deve imprimir **2** ou mais (funcao + chamadas).

---

## Bloco 3 — connectionScope + connectionsSyncRoutes + server.ts

```bash
python3 <<'PY'
from pathlib import Path
# connectionScope
p = Path("src/utils/connectionScope.ts")
t = p.read_text(encoding="utf-8")
if "metadataOwnerUid" not in t:
    t = t.replace(
        "export function ownsConnectionForUid(\n  socketUid: string | null | undefined,\n  connectionId: string\n): boolean {",
        "export function ownsConnectionForUid(\n  socketUid: string | null | undefined,\n  connectionId: string,\n  metadataOwnerUid?: string | null\n): boolean {",
        1,
    )
    t = t.replace(
        "  if (!connectionId) return false;\n  if (isLegacyConnectionId(connectionId)) {",
        "  if (!connectionId) return false;\n  const uid = !socketUid || socketUid === 'anonymous' ? 'anonymous' : socketUid;\n  const idx = connectionId.indexOf('__');\n  if (idx > 0) {\n    const owner = connectionId.slice(0, idx);\n    if (uid === 'anonymous') return owner === 'anonymous';\n    return owner === uid;\n  }\n  if (metadataOwnerUid) {\n    if (uid === 'anonymous') return metadataOwnerUid === 'anonymous';\n    return metadataOwnerUid === uid;\n  }\n  if (isLegacyConnectionId(connectionId)) {",
        1,
    )
    old = "  const idx = connectionId.indexOf('__');\n  if (idx <= 0) return false;\n\n  const owner = connectionId.slice(0, idx);\n  const uid = !socketUid || socketUid === 'anonymous' ? 'anonymous' : socketUid;\n\n  if (uid === 'anonymous') return owner === 'anonymous';\n  return owner === uid;\n}"
    if old in t:
        t = t.replace(old, "  return false;\n}", 1)
    t = t.replace(
        "    return ownsConnectionForUid(uid, key);",
        "    const meta = typeof (item as { ownerUid?: string }).ownerUid === 'string' ? (item as { ownerUid?: string }).ownerUid : undefined;\n    return ownsConnectionForUid(uid, key, meta);",
        1,
    )
    p.write_text(t, encoding="utf-8")
    print("OK connectionScope")
else:
    print("OK connectionScope (ja)")
PY

cat > server/connectionsSyncRoutes.ts <<'EOF'
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
            if (typeof ou === 'string' && ou.trim()) tenantUid = ou.trim();
        }
    } catch { /* */ }
    return tenantUid;
}

export function registerConnectionsSyncRoutes(app: Express): void {
    app.post('/api/connections/sync', async (req, res) => {
        try {
            const idToken = parseBearer(req);
            if (!idToken) return res.status(401).json({ ok: false, error: 'Bearer obrigatorio' });
            const tenantUid = await resolveTenantUid(idToken);
            if (!tenantUid) return res.status(401).json({ ok: false, error: 'Token invalido' });
            const result = await evolutionService.syncConnectionsForOwner(tenantUid);
            return res.json({
                ok: true,
                connections: filterByConnectionScope(tenantUid, result.connections),
                claimed: result.claimed,
                syncedChats: result.syncedChats,
            });
        } catch (e) {
            return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
        }
    });
}
EOF
echo "OK connectionsSyncRoutes.ts"

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
    t = t.replace("registerProductSuggestionRoutes(app);", "registerProductSuggestionRoutes(app);\nregisterConnectionsSyncRoutes(app);", 1)
if "syncConnectionsForOwner(uid)" not in t:
    t = t.replace(
        "    emitScopedConnections();\n    socket.emit('metrics-update', emptyMetrics);",
        "    emitScopedConnections();\n    if (uid && uid !== 'anonymous') {\n      void evolutionService.syncConnectionsForOwner(uid).then(() => emitScopedConnections());\n    }\n    socket.emit('metrics-update', emptyMetrics);",
        1,
    )
p.write_text(t, encoding="utf-8")
print("OK server.ts")
PY
```

---

## Bloco 4 — Build

```bash
grep -c syncConnectionsForOwner server/evolutionService.ts
docker build -t zapmass:latest .
docker service update --force --image zapmass:latest zapmass_api
sleep 35
CID=$(docker ps -q -f name=zapmass_api | head -1)
docker exec "$CID" grep -c syncConnectionsForOwner /app/server/evolutionService.ts
curl -sf http://127.0.0.1:3001/api/health && echo OK
```

Container deve mostrar **>= 1**. Depois **Ctrl+F5** no site.

---

## Upload alternativo (File Manager Hostinger)

Se colar falhar, envie pelo Gerenciador de Arquivos:

- `server/evolutionService.ts` (do seu PC)
- `server/connectionsSyncRoutes.ts`
- `server/server.ts`

Para `/opt/zapmass/...` e rode só o **Bloco 4**.
