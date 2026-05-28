#!/usr/bin/env bash
# Corrige webhook Evolution v2 (HTTP 400) + ZAPMASS_WEBHOOK_URL público + redeploy API.
# Uso: cd /opt/zapmass && bash deployment/hotfix-evolution-webhook-v2.sh
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
ENV="${ENV_PATH:-$ROOT/.env}"
FILE="$ROOT/server/evolutionService.ts"

log() { echo "==> $*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root." >&2
  exit 1
fi

cd "$ROOT"

if [ ! -f "$FILE" ]; then
  echo "Erro: $FILE nao encontrado." >&2
  exit 1
fi

log "Backup evolutionService.ts"
cp -a "$FILE" "${FILE}.bak.$(date +%Y%m%d%H%M%S)"

if grep -q 'webhook: {' "$FILE" && grep -q 'byEvents: false' "$FILE"; then
  log "setupWebhook ja parece estar no formato Evolution v2 (byEvents: false)"
else
  log "Aplicar patch setupWebhook (Evolution API v2)"
  python3 <<'PY'
from pathlib import Path

path = Path("server/evolutionService.ts")
text = path.read_text(encoding="utf-8")
marker = "async function setupWebhook(instanceName: string)"
start = text.find(marker)
if start < 0:
    raise SystemExit("setupWebhook nao encontrado")

brace = text.find("{", start)
depth = 0
end = None
for i in range(brace, len(text)):
    c = text[i]
    if c == "{":
        depth += 1
    elif c == "}":
        depth -= 1
        if depth == 0:
            end = i + 1
            break
if end is None:
    raise SystemExit("fim de setupWebhook nao encontrado")

new_fn = '''async function setupWebhook(instanceName: string) {
    try {
        const url = evolutionConfig.webhookUrl;
        const events = [
            'QRCODE_UPDATED',
            'CONNECTION_UPDATE',
            'MESSAGES_UPSERT',
            'MESSAGES_UPDATE',
            'SEND_MESSAGE',
        ];
        await api.post(`/webhook/set/${instanceName}`, {
            webhook: {
                enabled: true,
                url,
                byEvents: false,
                base64: true,
                events,
            },
        });
        log('info', `Webhook configurado para ${instanceName}`, { url });
    } catch (error: any) {
        const detail = error?.response?.data;
        log('warn', `Erro ao configurar webhook para ${instanceName}`, {
            error: error.message,
            response: detail,
        });
    }
}'''

path.write_text(text[:start] + new_fn + text[end:], encoding="utf-8")
print("OK: setupWebhook actualizado")
PY
fi

# Swarm: Evolution corre na rede overlay — tem de chamar a API por hostname interno, nao pelo dominio publico.
log "ZAPMASS_WEBHOOK_URL -> http://api:3001/webhook/evolution"
if grep -qE '^[[:space:]]*ZAPMASS_WEBHOOK_URL=' "$ENV"; then
  sed -i 's|^[[:space:]]*ZAPMASS_WEBHOOK_URL=.*|ZAPMASS_WEBHOOK_URL=http://api:3001/webhook/evolution|' "$ENV"
else
  echo 'ZAPMASS_WEBHOOK_URL=http://api:3001/webhook/evolution' >> "$ENV"
fi

chmod +x deployment/vps-deploy.sh 2>/dev/null || true
log "Redeploy stack (rebuild imagem + zapmass_api)"
bash deployment/vps-deploy.sh

API_KEY="$(grep -E '^[[:space:]]*EVOLUTION_API_KEY=' "$ENV" | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//')"
WEBHOOK_URL="$(grep -E '^[[:space:]]*ZAPMASS_WEBHOOK_URL=' "$ENV" | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//')"
API_KEY="${API_KEY:-zapmass-secure-key-2026}"
WEBHOOK_URL="${WEBHOOK_URL:-https://zap-mass.com/webhook/evolution}"

log "Reconfigurar webhook (byEvents:false) em instancias Evolution existentes"
export WEBHOOK_URL API_KEY
INST_TMP="$(mktemp)"
if curl -sf -H "apikey: $API_KEY" http://127.0.0.1:8080/instance/fetchInstances -o "$INST_TMP" 2>/dev/null; then
  INST_FILE="$INST_TMP" python3 <<'PY'
import json, os, urllib.request

path = os.environ.get("INST_FILE", "")
if not path or not os.path.isfile(path):
    raise SystemExit(0)
with open(path, encoding="utf-8") as f:
    data = json.load(f)
items = data if isinstance(data, list) else data.get("instances") or []
url = os.environ.get("WEBHOOK_URL", "https://zap-mass.com/webhook/evolution")
key = os.environ.get("API_KEY", "zapmass-secure-key-2026")
body = json.dumps({
    "webhook": {
        "enabled": True,
        "url": url,
        "byEvents": False,
        "base64": True,
        "events": ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT", "MESSAGES_UPDATE", "SEND_MESSAGE"],
    }
}).encode()
for item in items:
    if not isinstance(item, dict):
        continue
    name = str(
        item.get("name") or item.get("instanceName")
        or (item.get("instance") or {}).get("instanceName") or ""
    ).strip()
    if not name:
        continue
    req = urllib.request.Request(
        f"http://127.0.0.1:8080/webhook/set/{name}",
        data=body,
        headers={"apikey": key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            print(f"OK webhook {name} HTTP {resp.status}")
    except Exception as e:
        print(f"WARN webhook {name}: {e}")
PY
else
  log "AVISO: fetchInstances vazio ou Evolution indisponivel"
fi
rm -f "$INST_TMP"

echo ""
log "Teste rapido webhook v2 numa instancia existente (opcional):"
echo "  INSTANCE=conn_XXXX"
echo '  curl -s -w "\nHTTP:%{http_code}\n" -X POST http://127.0.0.1:8080/webhook/set/${INSTANCE} \'
echo '    -H "apikey: zapmass-secure-key-2026" -H "Content-Type: application/json" \'
echo '    -d '"'"'{"webhook":{"enabled":true,"url":"http://api:3001/webhook/evolution","byEvents":false,"base64":true,"events":["QRCODE_UPDATED"]}}'"'"
echo ""
log "Pronto. Abra https://zap-mass.com -> Nova Conexao -> Gerar QR (conexao NOVA)."
