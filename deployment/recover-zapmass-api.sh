#!/usr/bin/env bash
# Recupera zapmass_api (0/1) e aplica patch connection-ready de forma segura.
# Uso: cd /opt/zapmass && bash deployment/recover-zapmass-api.sh
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
FILE="$ROOT/server/evolutionService.ts"

log() { echo "==> $*"; }
ok() { echo "OK: $*"; }

cd "$ROOT"

log "Estado actual"
docker service ls --filter name=zapmass_api --format '{{.Name}} {{.Replicas}}' || true

if [ ! -f "$FILE" ]; then
  echo "Erro: $FILE nao encontrado" >&2
  exit 1
fi

# Validar sintaxe basica (chaves balanceadas)
python3 <<'PY'
from pathlib import Path
p = Path("server/evolutionService.ts")
t = p.read_text(encoding="utf-8")
if t.count("{") != t.count("}"):
    raise SystemExit(f"ERRO: chaves desbalanceadas {{={t.count('{')} }}={t.count('}')}")
if "emitConnectionOpenToFrontend" in t and "connection-ready" not in t:
    raise SystemExit("ERRO: emitConnectionOpenToFrontend incompleto")
print("OK: ficheiro parece intacto")
PY
valid=$?
if [ "$valid" -ne 0 ]; then
  log "Restaurar backup mais recente"
  bak="$(ls -t server/evolutionService.ts.bak.* 2>/dev/null | head -1 || true)"
  if [ -z "$bak" ]; then
    echo "Sem backup .bak — corrija server/evolutionService.ts manualmente" >&2
    exit 1
  fi
  cp -a "$bak" "$FILE"
  ok "Restaurado de $bak"
fi

# Patch minimo e idempotente
python3 <<'PY'
from pathlib import Path
path = Path("server/evolutionService.ts")
text = path.read_text(encoding="utf-8")

if "function emitConnectionOpenToFrontend" not in text:
    insert_before = "function ownerUidFromConnectionId(connectionId: string)"
    block = r'''
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

'''
    if insert_before not in text:
        raise SystemExit("ownerUidFromConnectionId nao encontrado")
    text = text.replace(insert_before, block + insert_before, 1)
    print("PATCH: emitConnectionOpenToFrontend adicionado")

marker = "log('info', `Status atualizado: ${instance} → ${status}`);"
if marker in text and "emitConnectionOpenToFrontend(instance)" not in text:
    text = text.replace(
        marker,
        marker + "\n\n                if (status === 'ONLINE' || String(data?.state || '').toLowerCase() === 'open') {\n                    emitConnectionOpenToFrontend(instance);",
        1,
    )
    print("PATCH: CONNECTION_UPDATE -> connection-ready")

path.write_text(text, encoding="utf-8")
PY

log "Build imagem"
docker build -t zapmass:latest .

log "Force update API"
docker service update --force --image zapmass:latest zapmass_api

log "Aguardar 1/1"
for i in $(seq 1 30); do
  rep="$(docker service ls --filter name=zapmass_api --format '{{.Replicas}}' 2>/dev/null || echo '')"
  echo "  tentativa $i: replicas=$rep"
  if [ "$rep" = "1/1" ]; then
    ok "zapmass_api 1/1"
    curl -sf http://127.0.0.1:3001/api/health && echo "" && ok "health OK"
    exit 0
  fi
  sleep 5
done

log "AVISO: ainda nao 1/1 — ver logs:"
docker service ps zapmass_api --no-trunc | head -5
docker service logs zapmass_api --tail 40 2>&1 | tail -40
exit 1
