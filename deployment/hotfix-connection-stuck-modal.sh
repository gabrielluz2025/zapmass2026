#!/usr/bin/env bash
# Modal trava em "Aguardando leitura" — connection-ready + polling Evolution v2 (tudo num script).
# Uso: cd /opt/zapmass && bash deployment/hotfix-connection-stuck-modal.sh
set -euo pipefail
cd "${ROOT:-/opt/zapmass}"
FILE="server/evolutionService.ts"

if [ ! -f "$FILE" ]; then
  echo "Erro: $FILE nao encontrado." >&2
  exit 1
fi

cp -a "$FILE" "${FILE}.bak.$(date +%Y%m%d%H%M%S)"

python3 <<'PY'
from pathlib import Path
import re

path = Path("server/evolutionService.ts")
text = path.read_text(encoding="utf-8")

if text.count("{") != text.count("}"):
    raise SystemExit("ERRO: chaves desbalanceadas — abortar")

anchor = "function ownerUidFromConnectionId(connectionId: string)"

# --- 1) connection-ready (se git checkout removeu o patch anterior) ---
if "function emitConnectionOpenToFrontend" not in text:
    emit_block = """
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

"""
    if anchor not in text:
        raise SystemExit("anchor ownerUidFromConnectionId nao encontrado")
    text = text.replace(anchor, emit_block + anchor, 1)
    print("PATCH: emitConnectionOpenToFrontend")

# --- 2) polling + parser v2 ---
if "function parseConnectionStatePayload" not in text:
    poll_block = """
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
        const state = (nested as Record<string, unknown>).state;
        if (typeof state === 'string') return state;
    }
    return 'close';
}

function parseConnectionStateFromData(data: unknown): string {
    if (!data || typeof data !== 'object') return '';
    const row = data as Record<string, unknown>;
    if (typeof row.state === 'string') return row.state;
    const nested = row.instance;
    if (nested && typeof nested === 'object') {
        const state = (nested as Record<string, unknown>).state;
        if (typeof state === 'string') return state;
    }
    return '';
}

const connectionWatchTimers = new Map<string, ReturnType<typeof setTimeout>>();

function stopWatchingConnection(connectionId: string) {
    const timer = connectionWatchTimers.get(connectionId);
    if (timer) {
        clearTimeout(timer);
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
        if (state === 'open') {
            conn.qrCode = undefined;
            const wuid =
                typeof data?.wuid === 'string'
                    ? data.wuid
                    : typeof data?.instance === 'object' &&
                        typeof (data.instance as Record<string, unknown>).wuid === 'string'
                      ? String((data.instance as Record<string, unknown>).wuid)
                      : '';
            if (wuid) {
                conn.phoneNumber = wuid.split('@')[0]?.replace(/\\D/g, '') || conn.phoneNumber;
            }
        }
        connections.set(instance, conn);
    }
    const updatePayload = {
        id: instance,
        status,
        profilePicUrl: data?.profilePicUrl,
        profileName: data?.profileName,
    };
    const ownerUid = ownerUidFromConnectionId(instance);
    if (ownerUid) {
        publishOwnerEvent(ownerUid, 'connection-update', updatePayload);
        publishOwnerEvent(ownerUid, 'connections-update', getConnections());
    } else if (io) {
        io.emit('connection-update', updatePayload);
        io.emit('connections-update', getConnections());
    }
    log('info', `Status atualizado: ${instance} → ${status}`);
    if (state === 'open') {
        stopWatchingConnection(instance);
        emitConnectionOpenToFrontend(instance);
        void chatStore.syncChatsForConnection(instance);
    }
}

function watchConnectionUntilOpen(connectionId: string) {
    if (!connectionId || connectionWatchTimers.has(connectionId)) return;
    const existing = connections.get(connectionId);
    if (existing?.status === 'open') return;
    let attempts = 0;
    const maxAttempts = 90;
    const poll = async () => {
        if (!connections.has(connectionId)) {
            stopWatchingConnection(connectionId);
            return;
        }
        attempts++;
        const state = (await getConnectionState(connectionId)).toLowerCase();
        if (state === 'open') {
            applyConnectionStateUpdate(connectionId, state, {});
            return;
        }
        if (attempts >= maxAttempts) {
            stopWatchingConnection(connectionId);
            log('warn', `Timeout aguardando conexao abrir: ${connectionId}`);
            return;
        }
        connectionWatchTimers.set(connectionId, setTimeout(() => void poll(), 2000));
    };
    connectionWatchTimers.set(connectionId, setTimeout(() => void poll(), 2000));
}

"""
    text = text.replace(anchor, poll_block + anchor, 1)
    print("PATCH: polling + applyConnectionStateUpdate")

if "return parseConnectionStatePayload(response.data)" not in text:
    text2, n = re.subn(
        r"return response\.data\?\.state \|\| 'close';",
        "return parseConnectionStatePayload(response.data);",
        text,
        count=1,
    )
    if n:
        text = text2
        print("PATCH: getConnectionState v2")

if "watchConnectionUntilOpen(connectionId)" not in text:
    old = "        io.emit('connections-update', getConnections());\n    }\n}"
    new = "        io.emit('connections-update', getConnections());\n    }\n    watchConnectionUntilOpen(connectionId);\n}"
    if old in text:
        text = text.replace(old, new, 1)
        print("PATCH: watchConnectionUntilOpen em emitQrToFrontend")

if "const { instance, data } = event;" in text:
    text = text.replace(
        "        const { instance, data } = event;",
        "        const instance = resolveInstanceName(event?.instance ?? event?.instanceName);\n        const data = event?.data ?? event;",
        1,
    )
    print("PATCH: handleWebhook instance resolver")

conn_case = re.search(r"case 'CONNECTION_UPDATE':\s*\{.*?break;\s*\}", text, re.DOTALL)
if conn_case and "applyConnectionStateUpdate(" not in conn_case.group(0):
    new_case = """case 'CONNECTION_UPDATE': {
                const rawState = parseConnectionStateFromData(data);
                applyConnectionStateUpdate(
                    instance,
                    rawState,
                    data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined
                );
                break;
            }"""
    text = text[: conn_case.start()] + new_case + text[conn_case.end() :]
    print("PATCH: CONNECTION_UPDATE simplificado")
elif conn_case and "applyConnectionStateUpdate(" not in text:
    # CONNECTION_UPDATE antigo sem apply — reescrever
    new_case = """case 'CONNECTION_UPDATE': {
                const rawState = parseConnectionStateFromData(data);
                applyConnectionStateUpdate(
                    instance,
                    rawState,
                    data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined
                );
                break;
            }"""
    text = text[: conn_case.start()] + new_case + text[conn_case.end() :]
    print("PATCH: CONNECTION_UPDATE reescrito")

if "stopWatchingConnection(id)" not in text:
    text = text.replace(
        "        await api.delete(`/instance/delete/${id}`);\n        connections.delete(id);",
        "        await api.delete(`/instance/delete/${id}`);\n        stopWatchingConnection(id);\n        connections.delete(id);",
        1,
    )

path.write_text(text, encoding="utf-8")
if text.count("{") != text.count("}"):
    raise SystemExit("ERRO: chaves desbalanceadas apos patch")
print("OK: pronto para build")
PY

docker build -t zapmass:latest .
docker service update --force --image zapmass:latest zapmass_api

for i in $(seq 1 24); do
  rep=$(docker service ls --filter name=zapmass_api --format '{{.Replicas}}' 2>/dev/null || echo '')
  echo "tentativa $i: $rep"
  curl -sf http://127.0.0.1:3001/api/health >/dev/null 2>&1 && echo "API OK — teste Nova Conexao + QR" && exit 0
  sleep 5
done
docker service logs zapmass_api --tail 20
exit 1
