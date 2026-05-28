#!/usr/bin/env bash
# Emite connection-ready ao WhatsApp conectar (Evolution CONNECTION_UPDATE → open/ONLINE).
# Uso: cd /opt/zapmass && bash deployment/hotfix-evolution-connection-ready.sh
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
FILE="$ROOT/server/evolutionService.ts"

log() { echo "==> $*"; }

cd "$ROOT"
[ -f "$FILE" ] || { echo "Erro: $FILE nao encontrado" >&2; exit 1; }

cp -a "$FILE" "${FILE}.bak.$(date +%Y%m%d%H%M%S)"

python3 <<'PY'
from pathlib import Path

path = Path("server/evolutionService.ts")
text = path.read_text(encoding="utf-8")

if "function emitConnectionOpenToFrontend" not in text:
    anchor = "function ownerUidFromConnectionId(connectionId: string)"
    if anchor not in text:
        anchor = "function emitQrToFrontend("
    helpers = '''
function emitToConnectionFrontend(
    connectionId: string,
    event: string,
    payload: Record<string, unknown>
) {
    const ownerUid = ownerUidFromConnectionId(connectionId);
    if (ownerUid) {
        publishOwnerEvent(ownerUid, event, payload);
        return;
    }
    if (io) io.emit(event, payload);
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

'''
    if anchor == "function emitQrToFrontend(":
        text = text.replace(anchor, helpers + anchor, 1)
    else:
        text = text.replace(anchor, helpers + anchor, 1)
    print("OK: helpers emitConnectionOpenToFrontend adicionados")
else:
    print("OK: emitConnectionOpenToFrontend ja existe")

if "emitConnectionOpenToFrontend(instance)" not in text:
    needles = [
        'log(\'info\', `Status atualizado: ${instance} → ${status}`);\n\n                if (data.state === \'open\') {',
        "log('info', `Status atualizado: ${instance} → ${status}`);\n\n                if (data.state === 'open') {",
        'log(\'info\', `Status atualizado: ${instance} → ${status}`);\n\n                if (state === \'open\') {',
        "log('info', `Status atualizado: ${instance} → ${status}`);\n\n                if (state === 'open') {",
    ]
    replaced = False
    for n in needles:
        if n in text:
            text = text.replace(
                n,
                n.split("\n\n                if")[0]
                + "\n\n                if (status === 'ONLINE' || state === 'open') {\n                    emitConnectionOpenToFrontend(instance);"
                + "\n                if" + n.split("\n\n                if", 1)[1],
                1,
            )
            replaced = True
            break
    if not replaced:
        marker = 'log(\'info\', `Status atualizado: ${instance} → ${status}`);'
        if marker in text and "emitConnectionOpenToFrontend(instance)" not in text:
            text = text.replace(
                marker,
                marker
                + "\n\n                if (status === 'ONLINE' || state === 'open') {\n                    emitConnectionOpenToFrontend(instance);",
                1,
            )
            replaced = True
    if replaced:
        print("OK: CONNECTION_UPDATE chama emitConnectionOpenToFrontend")
    else:
        raise SystemExit("Nao foi possivel inserir emitConnectionOpenToFrontend em CONNECTION_UPDATE")
else:
    print("OK: CONNECTION_UPDATE ja chama emitConnectionOpenToFrontend")

path.write_text(text, encoding="utf-8")
PY

chmod +x deployment/vps-deploy.sh 2>/dev/null || true
log "Redeploy API"
bash deployment/vps-deploy.sh

echo ""
log "Pronto. Feche o modal e veja o canal na lista, ou teste Nova Conexao de novo."
