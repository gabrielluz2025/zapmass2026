#!/usr/bin/env bash
# Um comando: polling + connection-ready (ancora emitQrToFrontend — VPS antiga).
# Uso: cd /opt/zapmass && bash deployment/vps-fix-modal-now.sh
set -euo pipefail
cd /opt/zapmass
F=server/evolutionService.ts
cp -a "$F" "${F}.bak.$(date +%Y%m%d%H%M%S)"

python3 <<'PY'
from pathlib import Path
import re
p = Path("server/evolutionService.ts")
t = p.read_text(encoding="utf-8")
if t.count("{") != t.count("}"):
    raise SystemExit("chaves desbalanceadas")
ank = "function emitQrToFrontend"
if ank not in t:
    raise SystemExit("emitQrToFrontend nao encontrado")

if "function ownerUidFromConnectionId" not in t:
    t = t.replace(
        ank,
        """
function ownerUidFromConnectionId(connectionId: string): string | undefined {
    const idx = connectionId.indexOf('__');
    return idx > 0 ? connectionId.slice(0, idx) : undefined;
}

""" + ank,
        1,
    )
    print("OK: ownerUidFromConnectionId")

if "function emitConnectionOpenToFrontend" not in t:
    t = t.replace(
        ank,
        """
function emitConnectionOpenToFrontend(connectionId: string) {
    const payload = { connectionId };
    if (io) {
        io.emit('connection-progress', { connectionId, phase: 'authenticated' });
        io.emit('connection-authenticated', payload);
        io.emit('connection-progress', { connectionId, phase: 'ready' });
        io.emit('connection-ready', payload);
    }
    const ou = ownerUidFromConnectionId(connectionId);
    if (ou) {
        publishOwnerEvent(ou, 'connection-progress', { connectionId, phase: 'authenticated' });
        publishOwnerEvent(ou, 'connection-authenticated', payload);
        publishOwnerEvent(ou, 'connection-progress', { connectionId, phase: 'ready' });
        publishOwnerEvent(ou, 'connection-ready', payload);
    }
}

""" + ank,
        1,
    )
    print("OK: emitConnectionOpenToFrontend")

if "watchConnectionUntilOpen" not in t:
    block = """
function parseConnectionStatePayload(data: unknown): string {
    if (!data || typeof data !== 'object') return 'close';
    const row = data as Record<string, unknown>;
    if (typeof row.state === 'string') return row.state;
    const nested = row.instance;
    if (nested && typeof nested === 'object') {
        const s = (nested as Record<string, unknown>).state;
        if (typeof s === 'string') return s;
    }
    return 'close';
}
function parseConnectionStateFromData(data: unknown): string {
    if (!data || typeof data !== 'object') return '';
    const row = data as Record<string, unknown>;
    if (typeof row.state === 'string') return row.state;
    const nested = row.instance;
    if (nested && typeof nested === 'object') {
        const s = (nested as Record<string, unknown>).state;
        if (typeof s === 'string') return s;
    }
    return '';
}
const connectionWatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
function stopWatchingConnection(connectionId: string) {
    const timer = connectionWatchTimers.get(connectionId);
    if (timer) { clearTimeout(timer); connectionWatchTimers.delete(connectionId); }
}
function applyConnectionStateUpdate(instance: string, rawState: string) {
    if (!instance) return;
    const state = String(rawState || '').toLowerCase();
    if (!state) return;
    const status = state === 'open' ? 'ONLINE' : state === 'connecting' ? 'CONNECTING' : 'OFFLINE';
    const conn = connections.get(instance);
    if (conn) {
        conn.status = mapEvolutionState(state);
        if (state === 'open') conn.qrCode = undefined;
        connections.set(instance, conn);
    }
    const updatePayload = { id: instance, status };
    const ou = ownerUidFromConnectionId(instance);
    if (ou) {
        publishOwnerEvent(ou, 'connection-update', updatePayload);
        publishOwnerEvent(ou, 'connections-update', getConnections());
    } else if (io) {
        io.emit('connection-update', updatePayload);
        io.emit('connections-update', getConnections());
    }
    log('info', `Status atualizado: ${instance} -> ${status}`);
    if (state === 'open') {
        stopWatchingConnection(instance);
        emitConnectionOpenToFrontend(instance);
        void chatStore.syncChatsForConnection(instance);
    }
}
function watchConnectionUntilOpen(connectionId: string) {
    if (!connectionId || connectionWatchTimers.has(connectionId)) return;
    if (connections.get(connectionId)?.status === 'open') return;
    let n = 0;
    const poll = async () => {
        if (!connections.has(connectionId)) { stopWatchingConnection(connectionId); return; }
        n++;
        const st = (await getConnectionState(connectionId)).toLowerCase();
        if (st === 'open') { applyConnectionStateUpdate(connectionId, st); return; }
        if (n >= 90) { stopWatchingConnection(connectionId); return; }
        connectionWatchTimers.set(connectionId, setTimeout(() => void poll(), 2000));
    };
    connectionWatchTimers.set(connectionId, setTimeout(() => void poll(), 2000));
}

"""
    t = t.replace(ank, block + ank, 1)
    print("OK: watchConnectionUntilOpen + polling")

t2, n = re.subn(
    r"return response\.data\?\.state \|\| 'close';",
    "return parseConnectionStatePayload(response.data);",
    t, 1,
)
if n: t = t2; print("OK: getConnectionState")

if "watchConnectionUntilOpen(connectionId)" not in t:
    o = "        io.emit('connections-update', getConnections());\n    }\n}"
    if o in t:
        t = t.replace(o, o.replace("\n    }\n}", "\n    }\n    watchConnectionUntilOpen(connectionId);\n}"), 1)
        print("OK: hook emitQr")
if "watchConnectionUntilOpen(id)" not in t and "emitQrToFrontend(id, extracted);" in t:
    t = t.replace(
        "emitQrToFrontend(id, extracted);",
        "emitQrToFrontend(id, extracted);\n            watchConnectionUntilOpen(id);",
        1,
    )
    print("OK: hook createConnection")

if "const { instance, data } = event;" in t:
    t = t.replace(
        "        const { instance, data } = event;",
        "        const instance = String(event?.instance ?? event?.instanceName ?? '').trim();\n        const data = event?.data ?? event;",
        1,
    )

m = re.search(r"case 'CONNECTION_UPDATE':\s*\{.*?break;\s*\}", t, re.DOTALL)
if m and "applyConnectionStateUpdate(" not in m.group(0):
    nc = """case 'CONNECTION_UPDATE': {
                const rawState = parseConnectionStateFromData(data);
                applyConnectionStateUpdate(instance, rawState);
                break;
            }"""
    t = t[: m.start()] + nc + t[m.end() :]
    print("OK: CONNECTION_UPDATE")

p.write_text(t, encoding="utf-8")
assert t.count("watchConnectionUntilOpen") >= 1
print("watch:", t.count("watchConnectionUntilOpen"), "emit:", t.count("emitConnectionOpenToFrontend"))
PY

grep -c watchConnectionUntilOpen "$F"
grep -c emitConnectionOpenToFrontend "$F"

# NAO usar --no-cache (npm cache quebra). Alterar ficheiro invalida COPY . .
docker build -t zapmass:latest .
docker service update --force --image zapmass:latest zapmass_api
sleep 20
curl -sf http://127.0.0.1:3001/api/health && echo " API OK"
CID=$(docker ps -q -f name=zapmass_api | head -1)
echo "container watch=$(docker exec "$CID" grep -c watchConnectionUntilOpen /app/server/evolutionService.ts)"
echo "container emit=$(docker exec "$CID" grep -c emitConnectionOpenToFrontend /app/server/evolutionService.ts)"
