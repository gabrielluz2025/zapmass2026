#!/usr/bin/env bash
# QR nao aparece / modal "Na fila - Aguardando worker" — força Evolution + monolith.
# Uso: cd /opt/zapmass && bash deployment/vps-fix-qr-not-generating.sh
set -euo pipefail
cd /opt/zapmass
ENV="${ENV_PATH:-.env}"

log() { echo "==> $*"; }

log "1) Estado actual"
docker service ls --format '{{.Name}} {{.Replicas}}' 2>/dev/null | grep -E 'zapmass_api|zapmass_evolution|wa-worker' || true

log "2) Variaveis no contentor API"
CID=$(docker ps -q -f name=zapmass_api | head -1)
if [ -n "$CID" ]; then
  docker exec "$CID" env | grep -E '^(ZAPMASS_WHATSAPP_ENGINE|SESSION_PROCESS_MODE|EVOLUTION_API|ZAPMASS_WEBHOOK|REDIS_URL)=' || true
else
  echo "AVISO: contentor zapmass_api nao encontrado"
fi

log "3) Ajustar .env (Evolution + monolith — QR nao usa wa-worker)"
touch "$ENV"
for kv in \
  "ZAPMASS_WHATSAPP_ENGINE=evolution" \
  "ZAPMASS_API_SESSION_MODE=monolith" \
  "WA_WORKER_REPLICAS=0" \
  "ZAPMASS_WEBHOOK_URL=http://api:3001/webhook/evolution"
do
  key="${kv%%=*}"
  if grep -qE "^[[:space:]]*${key}=" "$ENV"; then
    sed -i "s|^[[:space:]]*${key}=.*|${kv}|" "$ENV"
  else
    echo "$kv" >> "$ENV"
  fi
done

log "4) Evolution API"
API_KEY="$(grep -E '^[[:space:]]*EVOLUTION_API_KEY=' "$ENV" | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//')"
API_KEY="${API_KEY:-zapmass-secure-key-2026}"
if curl -sf -H "apikey: $API_KEY" http://127.0.0.1:8080/ >/dev/null 2>&1; then
  echo "OK: Evolution responde na porta 8080"
else
  echo "AVISO: Evolution nao responde em 127.0.0.1:8080 — verifique zapmass_evolution"
fi

log "5) Atualizar servico API (env + force)"
export $(grep -v '^#' "$ENV" | grep -E '^(ZAPMASS_WHATSAPP_ENGINE|ZAPMASS_API_SESSION_MODE)=' | xargs) 2>/dev/null || true
docker service update zapmass_api \
  --env-rm ZAPMASS_API_SESSION_MODE 2>/dev/null || true
docker service update zapmass_api \
  --env-add ZAPMASS_WHATSAPP_ENGINE=evolution \
  --env-add SESSION_PROCESS_MODE=monolith \
  --force 2>/dev/null || docker service update --force zapmass_api

log "6) Garantir wa-worker em 0 replicas (nao bloquear fila wwebjs)"
docker service scale zapmass_wa-worker=0 2>/dev/null || docker service scale zapmass-wa-worker=0 2>/dev/null || true

sleep 15
curl -sf http://127.0.0.1:3001/api/health && echo " API OK"

log "7) Teste manual Evolution (criar instancia teste)"
INST="test_qr_$(date +%s)"
HTTP=$(curl -s -o /tmp/evo_create.json -w "%{http_code}" -X POST "http://127.0.0.1:8080/instance/create" \
  -H "apikey: $API_KEY" -H "Content-Type: application/json" \
  -d "{\"instanceName\":\"$INST\",\"qrcode\":true,\"integration\":\"WHATSAPP-BAILEYS\"}" || echo "000")
echo "create HTTP $HTTP"
head -c 400 /tmp/evo_create.json 2>/dev/null; echo
curl -sf -X DELETE "http://127.0.0.1:8080/instance/delete/$INST" -H "apikey: $API_KEY" >/dev/null 2>&1 || true

echo ""
echo "Pronto. Recarregue https://zap-mass.com (Ctrl+F5) e tente Nova Conexao."
echo "Se ainda ficar na fila, veja logs: docker service logs -f zapmass_api 2>&1 | grep -iE 'Criando instancia|QR|Evolution|create-connection|worker'"
