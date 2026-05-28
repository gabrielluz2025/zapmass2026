#!/usr/bin/env bash
# VPS com evolutionService.ts ANTIGO (sem ownerUidFromConnectionId) — modal QR travado.
# Uso: cd /opt/zapmass && bash deployment/patch-old-evolution-vps.sh
set -euo pipefail
cd "${ROOT:-/opt/zapmass}"
FILE="server/evolutionService.ts"

[ -f "$FILE" ] || { echo "Erro: $FILE nao encontrado" >&2; exit 1; }
cp -a "$FILE" "${FILE}.bak.$(date +%Y%m%d%H%M%S)"

python3 <<'PY'
from pathlib import Path
import re

path = Path("server/evolutionService.ts")
text = path.read_text(encoding="utf-8")
if text.count("{") != text.count("}"):
    raise SystemExit("ERRO: chaves desbalanceadas")

anchor = "function emitQrToFrontend"
if anchor not in text:
    raise SystemExit(
        "ERRO: 'function emitQrToFrontend' nao encontrado.\n"
        "Rode: grep -n 'emitQr\\|handleWebhook\\|CONNECTION' server/evolutionService.ts | head -20"
    )

helpers = """
function ownerUidFromConnectionId(connectionId: string): string | undefined {
    const idx = connectionId.indexOf('__');
    return idx > 0 ? connectionId.slice(0, idx) : undefined;
}

function emitConnectionOpenToFrontend(connectionId: string) {
    const payload = { connectionId };
    if (io) {
        io.emit('connection-progress', { connectionId, phase: 'authenticated' });
        io.emit('connection-authenticated', payload);
        io.emit('connection-progress', { connectionId, phase: 'ready' });
        io.emit('connection-ready', payload);
    }
    const ownerUid = ownerUidFromConnectionId(connectionId);
    if (ownerUid) {
        publishOwnerEvent(ownerUid, 'connection-progress', { connectionId, phase: 'authenticated' });
        publishOwnerEvent(ownerUid, 'connection-authenticated', payload);
        publishOwnerEvent(ownerUid, 'connection-progress', { connectionId, phase: 'ready' });
        publishOwnerEvent(ownerUid, 'connection-ready', payload);
    }
}

function resolveInstanceName(raw: unknown): string {
    if (typeof raw === 'string') return raw.trim();
    if (raw && typeof raw === 'object') {
        const row = raw as Record<string, unknown>;
        return String(row.instanceName || row.name || '').trim();
    }
    return '';
}

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
    const t = connectionWatchTimers.get(connectionId);
    if (t) {
        clearTimeout(t);
        connectionWatchTimers.delete(connectionId);
    }
}

function applyConnectionStateUpdate(
    instance: string,
    rawState: string,
    data?: Record<string, unknown>
) {
    if (!instance) return;
    const state = String(rawState || '').toLowerCase();
    if (!state) return;
    const status =
        state === 'open' ? 'ONLINE' : state === 'connecting' ? 'CONNECTING' : 'OFFLINE';
    const conn = connections.get(instance);
    if (conn) {
        conn.status = mapEvolutionState(state);
        if (state === 'open') conn.qrCode = undefined;
        connections.set(instance, conn);
    }
    const updatePayload = { id: instance, status };
    const ownerUid = ownerUidFromConnectionId(instance);
    if (ownerUid) {
        publishOwnerEvent(ownerUid, 'connection-update', updatePayload);
        publishOwnerEvent(ownerUid, 'connections-update', getConnections());
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
        if (!connections.has(connectionId)) {
            stopWatchingConnection(connectionId);
            return;
        }
        n++;
        const st = (await getConnectionState(connectionId)).toLowerCase();
        if (st === 'open') {
            applyConnectionStateUpdate(connectionId, st, {});
            return;
        }
        if (n >= 90) {
            stopWatchingConnection(connectionId);
            log('warn', `Timeout aguardando conexao: ${connectionId}`);
            return;
        }
        connectionWatchTimers.set(connectionId, setTimeout(() => void poll(), 2000));
    };
    connectionWatchTimers.set(connectionId, setTimeout(() => void poll(), 2000));
}

"""

if "publishOwnerEvent" not in text:
    m = re.search(r"import\s*\{([^}]+)\}\s*from\s*['\"]\./whatsappService\.js['\"]", text)
    if m:
        inner = m.group(1).rstrip()
        if inner.endswith(","):
            inner = inner + "\n    publishOwnerEvent,"
        else:
            inner = inner + ",\n    publishOwnerEvent,"
        text = text[: m.start()] + f"import {{{inner}}} from './whatsappService.js'" + text[m.end() :]
        print("OK: import publishOwnerEvent")
    else:
        print("AVISO: publishOwnerEvent nao importado — eventos so via io.emit")

if "function emitConnectionOpenToFrontend" not in text:
    text = text.replace(anchor, helpers + anchor, 1)
    print("OK: helpers inseridos antes de emitQrToFrontend")

if "return parseConnectionStatePayload(response.data)" not in text:
    text2, n = re.subn(
        r"return response\.data\?\.state \|\| 'close';",
        "return parseConnectionStatePayload(response.data);",
        text,
        count=1,
    )
    if n:
        text = text2
        print("OK: getConnectionState v2")

if "watchConnectionUntilOpen(connectionId)" not in text:
    patterns = [
        (
            "        io.emit('connections-update', getConnections());\n    }\n}",
            "        io.emit('connections-update', getConnections());\n    }\n    watchConnectionUntilOpen(connectionId);\n}",
        ),
        (
            "        io.emit('connections-update', getConnections());\n    }\n}\n\nasync function fetchConnectQr",
            "        io.emit('connections-update', getConnections());\n    }\n    watchConnectionUntilOpen(connectionId);\n}\n\nasync function fetchConnectQr",
        ),
    ]
    for old, new in patterns:
        if old in text:
            text = text.replace(old, new, 1)
            print("OK: watchConnectionUntilOpen em emitQrToFrontend")
            break
    else:
        text = re.sub(
            r"(function emitQrToFrontend\([^)]*\)\s*\{[\s\S]*?)(\n\})\n(\nasync function fetchConnectQr)",
            r"\1\n    watchConnectionUntilOpen(connectionId);\n}\n\3",
            text,
            count=1,
        )
        if "watchConnectionUntilOpen(connectionId)" in text:
            print("OK: watchConnectionUntilOpen (regex)")

if "emitQrToFrontend(id, extracted)" in text and "watchConnectionUntilOpen(id)" not in text:
    text = text.replace(
        "emitQrToFrontend(id, extracted);",
        "emitQrToFrontend(id, extracted);\n            watchConnectionUntilOpen(id);",
        1,
    )
    print("OK: watch em createConnection")

if "const { instance, data } = event;" in text:
    text = text.replace(
        "        const { instance, data } = event;",
        "        const instance = resolveInstanceName(event?.instance ?? event?.instanceName);\n        const data = event?.data ?? event;",
        1,
    )
    print("OK: handleWebhook resolver")

m = re.search(r"case 'CONNECTION_UPDATE':\s*\{.*?break;\s*\}", text, re.DOTALL)
if m and "applyConnectionStateUpdate(" not in m.group(0):
    nc = """case 'CONNECTION_UPDATE': {
                const rawState = parseConnectionStateFromData(data);
                applyConnectionStateUpdate(
                    instance,
                    rawState,
                    data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined
                );
                break;
            }"""
    text = text[: m.start()] + nc + text[m.end() :]
    print("OK: CONNECTION_UPDATE")

# CONNECTION_UPDATE antigo que so faz log — acrescentar emit se tiver state open inline
if "case 'CONNECTION_UPDATE':" in text and "applyConnectionStateUpdate(" not in text:
    raise SystemExit("CONNECTION_UPDATE encontrado mas nao foi possivel reescrever — envie grep CONNECTION_UPDATE")

path.write_text(text, encoding="utf-8")
if text.count("{") != text.count("}"):
    raise SystemExit("ERRO: chaves desbalanceadas apos patch")

print("--- verificacao ---")
print("emitConnectionOpenToFrontend:", text.count("emitConnectionOpenToFrontend"))
print("watchConnectionUntilOpen:", text.count("watchConnectionUntilOpen"))
print("ownerUidFromConnectionId:", text.count("ownerUidFromConnectionId"))
if text.count("watchConnectionUntilOpen") < 1:
    raise SystemExit("FALHOU: watchConnectionUntilOpen ainda ausente")
PY

echo "--- disco ---"
grep -c "emitConnectionOpenToFrontend" "$FILE"
grep -c "watchConnectionUntilOpen" "$FILE"

docker build --no-cache -t zapmass:latest .
docker service update --force --image zapmass:latest zapmass_api
sleep 25
curl -sf http://127.0.0.1:3001/api/health && echo " API OK"
CID=$(docker ps -q -f name=zapmass_api | head -1)
echo "--- container ---"
docker exec "$CID" grep -c watchConnectionUntilOpen /app/server/evolutionService.ts
docker exec "$CID" grep -c emitConnectionOpenToFrontend /app/server/evolutionService.ts
