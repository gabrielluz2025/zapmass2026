#!/usr/bin/env bash
# Canal conectou na Evolution mas nao aparece no painel (id legado conn_* sem uid__).
# Aplica fix ownerUid + rebuild API.
set -euo pipefail
cd /opt/zapmass
log() { echo "==> $*"; }

log "Build API com fix de visibilidade (ownerUid em conn legado)"
docker build -t zapmass:latest .
docker service update --force --image zapmass:latest zapmass_api
sleep 25
curl -sf http://127.0.0.1:3001/api/health && echo " API OK"

log "Instancias Evolution abertas"
API_KEY="$(grep '^EVOLUTION_API_KEY=' .env | cut -d= -f2- | tr -d '\r')"
curl -s -H "apikey: $API_KEY" http://127.0.0.1:8080/instance/fetchInstances | head -c 1200
echo ""
echo ""
echo "No browser: Ctrl+F5 em https://zap-mass.com"
echo "Se ainda 0 canais: F12 > recarregar; o servidor vincula automaticamente se houver 1 instancia aberta orfa."
echo "Logs: docker service logs -f zapmass_api 2>&1 | grep -iE 'orphan|assign|connections-update|syncChats'"
