#!/usr/bin/env bash
# EMERGENCIA: zapmass_api 0/1 + 502 — restaura evolutionService.ts valido e sobe API.
# Uso: cd /opt/zapmass && bash deployment/emergency-restore-api.sh
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"
FILE="server/evolutionService.ts"

log() { echo "==> $*"; }

log "1) Tentar git checkout (ficheiro limpo do commit)"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git checkout -- "$FILE" 2>/dev/null && log "git checkout OK" || true
fi

log "2) Se ainda invalido, procurar backup .bak valido"
python3 <<'PY'
from pathlib import Path
import subprocess

def balanced(s: str) -> bool:
    return s.count("{") == s.count("}")

def has_broken_switch(s: str) -> bool:
    return "Unexpected" in s or "emitConnectionOpenToFrontend(instance);" in s and s.count("case 'CONNECTION_UPDATE'") > 1

path = Path("server/evolutionService.ts")
candidates = [path] + sorted(Path(".").glob("server/evolutionService.ts.bak.*"), key=lambda p: p.stat().st_mtime, reverse=True)

def try_file(p: Path) -> bool:
    t = p.read_text(encoding="utf-8")
    if not balanced(t):
        return False
    if "export function handleWebhook" not in t:
        return False
    if "case 'CONNECTION_UPDATE':" not in t:
        return False
    return True

chosen = None
for p in candidates:
    if p.exists() and try_file(p):
        chosen = p
        break

if chosen is None:
    raise SystemExit("Nenhum ficheiro valido encontrado (git ou .bak)")

if chosen != path:
    path.write_text(chosen.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"OK: restaurado de {chosen}")
else:
    print("OK: ficheiro actual ja valido")

text = path.read_text(encoding="utf-8")

# Patch idempotente: helpers + connection-ready
if "function emitConnectionOpenToFrontend" not in text:
    anchor = "function ownerUidFromConnectionId(connectionId: string)"
    block = """
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
    text = text.replace(anchor, block + anchor, 1)
    print("PATCH: emitConnectionOpenToFrontend")

import re
conn_case = re.search(
    r"case 'CONNECTION_UPDATE':\s*\{.*?break;\s*\}",
    text,
    re.DOTALL,
)
if not conn_case:
    raise SystemExit("case CONNECTION_UPDATE nao encontrado")

new_case = """case 'CONNECTION_UPDATE': {
                const rawState =
                    data?.state ??
                    (data?.instance && typeof data.instance === 'object'
                        ? (data.instance as Record<string, unknown>).state
                        : undefined);
                const state = String(rawState || '').toLowerCase();
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

                if (status === 'ONLINE' || state === 'open') {
                    emitConnectionOpenToFrontend(instance);
                    void chatStore.syncChatsForConnection(instance);
                }
                break;
            }"""

text = text[: conn_case.start()] + new_case + text[conn_case.end() :]
path.write_text(text, encoding="utf-8")

if not balanced(text):
    raise SystemExit("ERRO: chaves desbalanceadas apos patch")
print("PATCH: CONNECTION_UPDATE reescrito")
PY

log "3) Build + force update API"
docker build -t zapmass:latest .
docker service update --force --image zapmass:latest zapmass_api

log "4) Aguardar health"
for i in $(seq 1 36); do
  rep="$(docker service ls --filter name=zapmass_api --format '{{.Replicas}}' 2>/dev/null || echo '')"
  echo "  $i: replicas=$rep"
  if [ "$rep" = "1/1" ]; then
    if curl -sf http://127.0.0.1:3001/api/health >/dev/null; then
      echo "OK: API saudavel — https://zap-mass.com deve voltar"
      exit 0
    fi
  fi
  sleep 5
done

echo "FALHOU — logs:"
docker service logs zapmass_api --tail 25 2>&1
exit 1
