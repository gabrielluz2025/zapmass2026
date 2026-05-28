#!/usr/bin/env bash
# connect retorna {"count":0} — corrige CONFIG_SESSION_PHONE_VERSION na Evolution e testa QR.
# Uso: cd /opt/zapmass && bash deployment/vps-fix-count-zero-qr.sh
set -euo pipefail
cd /opt/zapmass
ENV="${ENV_PATH:-.env}"
API_KEY="$(grep -E '^[[:space:]]*EVOLUTION_API_KEY=' "$ENV" | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//')"
API_KEY="${API_KEY:-zapmass-secure-key-2026}"
VER="$(grep -E '^CONFIG_SESSION_PHONE_VERSION=' "$ENV" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
VER="${VER:-2.3000.1040093096}"

log() { echo "==> $*"; }

log "1) Variavel no .env"
grep -E 'CONFIG_SESSION_PHONE' "$ENV" || true
grep -q '^CONFIG_SESSION_PHONE_VERSION=' "$ENV" \
  && sed -i "s/^CONFIG_SESSION_PHONE_VERSION=.*/CONFIG_SESSION_PHONE_VERSION=${VER}/" "$ENV" \
  || echo "CONFIG_SESSION_PHONE_VERSION=${VER}" >> "$ENV"
grep -q '^CONFIG_SESSION_PHONE_CLIENT=' "$ENV" || echo 'CONFIG_SESSION_PHONE_CLIENT=Chrome' >> "$ENV"
grep -q '^CONFIG_SESSION_PHONE_NAME=' "$ENV" || echo 'CONFIG_SESSION_PHONE_NAME=Chrome' >> "$ENV"

log "2) Forcar env no servico Swarm (stack sozinho pode nao aplicar CONFIG_SESSION)"
docker service update --force \
  --env-add "CONFIG_SESSION_PHONE_VERSION=${VER}" \
  --env-add "CONFIG_SESSION_PHONE_CLIENT=Chrome" \
  --env-add "CONFIG_SESSION_PHONE_NAME=Chrome" \
  --env-add "SERVER_URL=http://127.0.0.1:8080" \
  --env-add "QRCODE_LIMIT=30" \
  zapmass_evolution
sleep 30

log "3) Confirmar env DENTRO do container Evolution"
CID="$(docker ps -q -f name=zapmass_evolution | head -1)"
if [ -n "$CID" ]; then
  docker exec "$CID" env | grep -E 'CONFIG_SESSION_PHONE|SERVER_URL|QRCODE' || echo "AVISO: variaveis nao visiveis no container"
else
  echo "AVISO: container evolution nao encontrado"
fi

log "4) Apagar instancia travada e criar teste"
curl -sf -X DELETE "http://127.0.0.1:8080/instance/delete/conn_1779712188497_1" -H "apikey: $API_KEY" >/dev/null 2>&1 || true
TEST="test_qr_$(date +%s)"
CREATE=$(curl -s -X POST "http://127.0.0.1:8080/instance/create" \
  -H "apikey: $API_KEY" -H "Content-Type: application/json" \
  -d "{\"instanceName\":\"$TEST\",\"qrcode\":true,\"integration\":\"WHATSAPP-BAILEYS\"}")
echo "$CREATE" | head -c 600; echo
if echo "$CREATE" | grep -qE 'base64|"code"'; then
  echo "OK: QR no create (test_qr_*)"
else
  sleep 3
  CONN=$(curl -s "http://127.0.0.1:8080/instance/connect/$TEST" -H "apikey: $API_KEY")
  echo "connect: $CONN"
fi
curl -sf -X DELETE "http://127.0.0.1:8080/instance/delete/$TEST" -H "apikey: $API_KEY" >/dev/null || true

log "4b) Mesmo teste com nome conn_* (como o painel)"
CONN_TEST="conn_$(date +%s)_1"
CREATE2=$(curl -s -X POST "http://127.0.0.1:8080/instance/create" \
  -H "apikey: $API_KEY" -H "Content-Type: application/json" \
  -d "{\"instanceName\":\"${CONN_TEST}\",\"qrcode\":true,\"integration\":\"WHATSAPP-BAILEYS\"}")
echo "$CREATE2" | head -c 600; echo
if echo "$CREATE2" | grep -qE 'base64|"code"'; then
  echo "OK: QR no create (${CONN_TEST})"
else
  echo "AVISO: create conn_* sem QR — apague instancias conn_* antigas no Manager"
fi
curl -sf -X DELETE "http://127.0.0.1:8080/instance/delete/${CONN_TEST}" -H "apikey: $API_KEY" >/dev/null || true

log "5) Webhook v2 na instancia teste (se ainda existir)"
echo ""
echo "Se connect ainda for count:0 mas o Manager (http://IP:8080/manager) mostrar QR,"
echo "o ZapMass pode receber via webhook QRCODE_UPDATED — teste Nova Conexao no site."
echo "Logs: docker service logs -f zapmass_api 2>&1 | grep -iE 'QR recebido|QRCODE'"
