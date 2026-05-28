#!/usr/bin/env bash
# Canal open na Evolution mas 0 no painel: deploy sync + limpar connecting + teste API.
set -euo pipefail
cd /opt/zapmass

log() { echo "==> $*"; }
API_KEY="$(grep '^EVOLUTION_API_KEY=' .env | cut -d= -f2- | tr -d '\r')"

log "1) Limpar instancias connecting (manter open)"
bash deployment/vps-cleanup-evolution-instances.sh 2>/dev/null || true

log "2) Build API (syncConnectionsForOwner + /api/connections/sync)"
docker build -t zapmass:latest .
docker service update --force --image zapmass:latest zapmass_api
sleep 30

log "3) Verificar codigo no container"
CID=$(docker ps -q -f name=zapmass_api | head -1)
docker exec "$CID" grep -c syncConnectionsForOwner /app/server/evolutionService.ts || echo "0 = IMAGEM ANTIGA"

log "4) Instancias Evolution"
curl -s -H "apikey: $API_KEY" http://127.0.0.1:8080/instance/fetchInstances | grep -oE '"name":"[^"]+"|"connectionStatus":"[^"]+"'

curl -sf http://127.0.0.1:3001/api/health && echo ""
echo ""
echo "No site: Ctrl+F5. O canal open deve aparecer apos 'Servidor conectado'."
echo "Teste manual (substitua FIREBASE_ID_TOKEN):"
echo '  curl -s -X POST http://127.0.0.1:3001/api/connections/sync -H "Authorization: Bearer TOKEN" | head -c 800'
