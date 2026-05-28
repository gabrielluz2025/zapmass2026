#!/usr/bin/env bash
# Webhook Evolution HTTP 400 + instancias zumbi = sem QR. Corrige setupWebhook v2 e limpa instancias.
# Uso: cd /opt/zapmass && bash deployment/vps-fix-webhook-qr-now.sh
set -euo pipefail
cd /opt/zapmass
ENV="${ENV_PATH:-.env}"
FILE="server/evolutionService.ts"

log() { echo "==> $*"; }

API_KEY="$(grep -E '^[[:space:]]*EVOLUTION_API_KEY=' "$ENV" | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//')"
WEBHOOK_URL="$(grep -E '^[[:space:]]*ZAPMASS_WEBHOOK_URL=' "$ENV" | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//')"
API_KEY="${API_KEY:-zapmass-secure-key-2026}"
WEBHOOK_URL="${WEBHOOK_URL:-http://api:3001/webhook/evolution}"

log "1) Corrigir setupWebhook no TS (Evolution v2) se ainda estiver v1"
if ! grep -q "webhook: {" "$FILE"; then
  cp -a "$FILE" "${FILE}.bak.webhook.$(date +%Y%m%d%H%M%S)"
  python3 <<'PY'
from pathlib import Path
import re
path = Path("server/evolutionService.ts")
text = path.read_text(encoding="utf-8")
start = text.find("async function setupWebhook(instanceName: string)")
if start < 0:
    raise SystemExit("setupWebhook nao encontrado")
brace = text.find("{", start)
depth = 0
end = None
for i in range(brace, len(text)):
    if text[i] == "{":
        depth += 1
    elif text[i] == "}":
        depth -= 1
        if depth == 0:
            end = i + 1
            break
if end is None:
    raise SystemExit("fim setupWebhook nao encontrado")
new_fn = """async function setupWebhook(instanceName: string) {
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
}"""
path.write_text(text[:start] + new_fn + text[end:], encoding="utf-8")
print("OK: setupWebhook v2")
PY
else
  echo "OK: setupWebhook ja e v2"
fi

log "2) Build + update API"
docker build -t zapmass:latest .
docker service update --force --image zapmass:latest zapmass_api
sleep 20

log "3) Limpar instancias zumbi (loop OFFLINE/CONNECTING)"
INST_TMP="$(mktemp)"
curl -sf -H "apikey: $API_KEY" http://127.0.0.1:8080/instance/fetchInstances -o "$INST_TMP"
export INST_TMP API_KEY
python3 <<PY
import json, os, urllib.request
path = os.environ["INST_TMP"]
key = os.environ["API_KEY"]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
items = data if isinstance(data, list) else data.get("instances") or []
for item in items:
    if not isinstance(item, dict):
        continue
    name = str(item.get("name") or item.get("instanceName") or "").strip()
    if not name or not name.startswith("conn_"):
        continue
    req = urllib.request.Request(
        f"http://127.0.0.1:8080/instance/delete/{name}",
        headers={"apikey": key},
        method="DELETE",
    )
    try:
        urllib.request.urlopen(req, timeout=20)
        print(f"apagada {name}")
    except Exception as e:
        print(f"falha {name}: {e}")
PY

log "4) Reconfigurar webhook em todas as instancias restantes"
INST_TMP2="$(mktemp)"
curl -sf -H "apikey: $API_KEY" http://127.0.0.1:8080/instance/fetchInstances -o "$INST_TMP2"
export WEBHOOK_URL API_KEY INST_FILE="$INST_TMP2"
python3 <<'PY'
import json, os, urllib.request
path = os.environ.get("INST_FILE", "")
if not path:
    raise SystemExit(0)
with open(path, encoding="utf-8") as f:
    data = json.load(f)
items = data if isinstance(data, list) else data.get("instances") or []
url = os.environ.get("WEBHOOK_URL", "http://api:3001/webhook/evolution")
key = os.environ.get("API_KEY", "")
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
    name = str(item.get("name") or item.get("instanceName") or "").strip()
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
        print(f"WARN {name}: {e}")
PY

log "5) Teste QR (instancia temporaria)"
TEST="test_qr_$(date +%s)"
HTTP=$(curl -s -o /tmp/evo_test.json -w "%{http_code}" -X POST "http://127.0.0.1:8080/instance/create" \
  -H "apikey: $API_KEY" -H "Content-Type: application/json" \
  -d "{\"instanceName\":\"$TEST\",\"qrcode\":true,\"integration\":\"WHATSAPP-BAILEYS\"}" || echo "000")
echo "create HTTP $HTTP"
grep -o '"base64"' /tmp/evo_test.json | head -1 || head -c 300 /tmp/evo_test.json; echo
curl -sf -X DELETE "http://127.0.0.1:8080/instance/delete/$TEST" -H "apikey: $API_KEY" >/dev/null || true

curl -sf http://127.0.0.1:3001/api/health && echo ""
echo ""
echo "Pronto. Ctrl+F5 no site -> Nova Conexao -> Gerar QR."
echo "Logs: docker service logs -f zapmass_api 2>&1 | grep -iE 'Criando|QR|webhook|400'"
