#!/usr/bin/env bash
# count:0 com CONFIG_SESSION ok → testar versao sem "-alpha" e/ou Evolution 2.3.6.
# Uso: cd /opt/zapmass && bash deployment/vps-evolution-qr-236.sh
set -euo pipefail
cd /opt/zapmass
ENV="${ENV_PATH:-.env}"
API_KEY="$(grep -E '^[[:space:]]*EVOLUTION_API_KEY=' "$ENV" | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//')"
API_KEY="${API_KEY:-zapmass-secure-key-2026}"

log() { echo "==> $*"; }
test_qr() {
  local ver="$1"
  log "Teste QR com CONFIG_SESSION_PHONE_VERSION=${ver}"
  docker service update --force \
    --env-add "CONFIG_SESSION_PHONE_VERSION=${ver}" \
    --env-add LOG_LEVEL=DEBUG \
    zapmass_evolution >/dev/null
  sleep 35
  local test="test_qr_${ver//[^a-zA-Z0-9]/_}_$(date +%s)"
  local out
  out=$(curl -s -X POST "http://127.0.0.1:8080/instance/create" \
    -H "apikey: $API_KEY" -H "Content-Type: application/json" \
    -d "{\"instanceName\":\"${test}\",\"qrcode\":true,\"integration\":\"WHATSAPP-BAILEYS\"}")
  echo "${out:0:500}"
  if echo "$out" | grep -qE 'base64|pairingCode|"code"'; then
    echo "OK: QR detectado com versao ${ver}"
    curl -sf -X DELETE "http://127.0.0.1:8080/instance/delete/${test}" -H "apikey: $API_KEY" >/dev/null || true
    return 0
  fi
  sleep 4
  out=$(curl -s "http://127.0.0.1:8080/instance/connect/${test}" -H "apikey: $API_KEY")
  echo "connect: $out"
  curl -sf -X DELETE "http://127.0.0.1:8080/instance/delete/${test}" -H "apikey: $API_KEY" >/dev/null || true
  echo "$out" | grep -qE 'base64|pairingCode|"code"' && return 0
  return 1
}

log "1) Versao sem sufixo -alpha (Baileys costuma rejeitar o texto do wppconnect)"
for ver in 2.3000.1040093096 2.3000.1040081378 2.3000.1023204200; do
  if test_qr "$ver"; then
    echo "CONFIG_SESSION_PHONE_VERSION=${ver}" >> "${ENV}.qr_ok"
    sed -i '/^CONFIG_SESSION_PHONE_VERSION=/d' "$ENV"
    echo "CONFIG_SESSION_PHONE_VERSION=${ver}" >> "$ENV"
    exit 0
  fi
done

log "2) Subir Evolution 2.3.6 (evoapicloud — corrige count:0 em muitos relatos)"
docker pull evoapicloud/evolution-api:v2.3.6
docker service update --force \
  --image evoapicloud/evolution-api:v2.3.6 \
  --env-add CONFIG_SESSION_PHONE_CLIENT=Chrome \
  --env-add CONFIG_SESSION_PHONE_NAME=Chrome \
  --env-add SERVER_URL=http://127.0.0.1:8080 \
  --env-add QRCODE_LIMIT=30 \
  --env-add LOG_LEVEL=INFO \
  zapmass_evolution
sleep 45
curl -sf -H "apikey: $API_KEY" http://127.0.0.1:8080/ | head -c 200; echo

if test_qr "2.3000.1040093096"; then
  echo "OK: Evolution 2.3.6 + QR"
  exit 0
fi

log "3) Logs Evolution (ultimas linhas com erro/baileys)"
docker service logs zapmass_evolution --tail 80 2>&1 | grep -iE 'error|baileys|version|qr|connect|fail' | tail -40 || true
echo ""
echo "Abra http://$(curl -s ifconfig.me 2>/dev/null || echo 127.0.0.1):8080/manager"
echo "Crie instancia la. Se o Manager mostrar QR mas API count:0, use Nova Conexao no site (webhook)."
exit 1
