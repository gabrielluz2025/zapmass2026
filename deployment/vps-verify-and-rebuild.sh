#!/usr/bin/env bash
# Verifica codigo NO DISCO (nao no container) e rebuild.
set -euo pipefail
cd /opt/zapmass

echo "=== Disco (/opt/zapmass) ==="
for f in server/evolutionService.ts server/connectionsSyncRoutes.ts server/server.ts; do
  if [ ! -f "$f" ]; then
    echo "FALTA: $f"
    exit 1
  fi
done
C=$(grep -c syncConnectionsForOwner server/evolutionService.ts || true)
echo "syncConnectionsForOwner no disco: $C"
if [ "$C" -lt 1 ]; then
  echo ""
  echo "ERRO: O codigo novo NAO esta em /opt/zapmass."
  echo "Copie do PC com: deployment/copiar-fix-conexao-vps.ps1"
  echo "Ou: git pull / rsync do repositorio atualizado."
  exit 1
fi
grep -q registerConnectionsSyncRoutes server/server.ts && echo "server.ts: registerConnectionsSyncRoutes OK" || {
  echo "FALTA registerConnectionsSyncRoutes em server.ts"
  exit 1
}

echo ""
echo "=== Build + deploy ==="
docker build -t zapmass:latest .
docker service update --force --image zapmass:latest zapmass_api
sleep 35

echo ""
echo "=== Container ==="
CID=$(docker ps -q -f name=zapmass_api | head -1)
docker exec "$CID" grep -c syncConnectionsForOwner /app/server/evolutionService.ts
curl -sf http://127.0.0.1:3001/api/health && echo ""
echo "Ctrl+F5 no site."
