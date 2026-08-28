#!/usr/bin/env bash
# Corrige ownerUid de chips "Gabinete" / "Disparo" para a conta do deputado Ismael.
# Uso na VPS (Web console Hostinger):
#   cd /opt/zapmass && bash deployment/fix-deputy-connections.sh
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
DEPUTY_UID="${DEPUTY_UID:-82a9217f-b4f3-4287-8be6-b3df7503e70e}"

cd "$ROOT"

CONTAINER="$(docker ps --format '{{.Names}}' | grep -i zapmass | head -1 || true)"
if [[ -z "$CONTAINER" ]]; then
  echo "[fix-deputy] Nenhum container zapmass em execução."
  docker ps -a --format 'table {{.Names}}\t{{.Status}}' | head -10
  exit 1
fi

echo "[fix-deputy] container=$CONTAINER deputy_uid=$DEPUTY_UID"
echo "[fix-deputy] IP público: $(curl -s --max-time 5 ifconfig.me || echo '?')"

mapfile -t TARGET_IDS < <(
  docker exec -w /app "$CONTAINER" node -e "
const { execSync } = require('child_process');
const j = execSync('npm run diagnose:connection-owners -- --json 2>/dev/null', { encoding: 'utf8' });
const d = JSON.parse(j);
for (const c of (d.connections || [])) {
  const n = (c.name || '').toLowerCase();
  if ((n.includes('gabinete') || n.includes('disparo')) && String(c.id || '').startsWith('conn_')) {
    console.log(c.id);
  }
}
"
)

if [[ ${#TARGET_IDS[@]} -eq 0 ]]; then
  echo "[fix-deputy] Nenhum chip gabinete/disparo encontrado:"
  docker exec -w /app "$CONTAINER" npm run diagnose:connection-owners 2>/dev/null | grep -iE 'gabinete|disparo|conn_' || true
  exit 0
fi

FIXED=0
for CID in "${TARGET_IDS[@]}"; do
  echo "[fix-deputy] --fix $CID -> $DEPUTY_UID"
  if docker exec -w /app "$CONTAINER" npm run diagnose:connection-owners -- --fix "$CID" "$DEPUTY_UID"; then
    FIXED=$((FIXED + 1))
  fi
done

if [[ "$FIXED" -gt 0 ]]; then
  echo "[fix-deputy] Reiniciando $CONTAINER..."
  docker restart "$CONTAINER"
  sleep 8
fi

echo ""
echo "=== Estado final ==="
docker exec -w /app "$CONTAINER" npm run diagnose:connection-owners 2>/dev/null | grep -iE 'gabinete|disparo|conn_' || true

echo ""
echo "=== Ban / quarentena ==="
docker exec "$CONTAINER" node -e "
const fs=require('fs');
const p='/app/data/connections_settings.json';
if(!fs.existsSync(p)){console.log('sem settings');process.exit(0)}
const d=JSON.parse(fs.readFileSync(p,'utf8'));
for(const [k,v] of Object.entries(d)){
  const n=(v.friendlyName||'').toLowerCase();
  if(n.includes('gabinete')||n.includes('disparo')){
    console.log(k, '|', v.friendlyName, '| owner=', v.ownerUid, '| ban=', v.banCount, '| reason=', v.lastBanReason);
  }
}
"

echo "[fix-deputy] concluído fixed=$FIXED"
