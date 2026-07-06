#!/usr/bin/env bash
# Diagnóstico rápido ZapMass na VPS (sem redis --scan lento).
# Uso: cd /opt/zapmass && bash deployment/zapmass-vps-status.sh
# Cron opcional: 0 */6 * * * cd /opt/zapmass && bash deployment/zapmass-vps-status.sh >> /var/log/zapmass-status.log 2>&1
set -u
REPORT="/tmp/zapmass-status-$(date +%Y%m%d-%H%M%S).txt"
exec > >(tee "$REPORT") 2>&1
cd /opt/zapmass || { echo "ERRO: /opt/zapmass não existe"; exit 1; }

WARN_MB="${REDIS_MEMORY_WARN_MB:-850}"

echo "======== HOST ========"
date -u; uptime; free -h | head -2; echo "CPUs: $(nproc)"

echo "======== CONTAINERS ========"
docker compose ps -a

echo "======== STATS ========"
docker stats --no-stream

echo "======== HEALTH ========"
curl -sf --max-time 10 http://127.0.0.1:3001/health; echo " /health"
curl -sf --max-time 10 http://127.0.0.1:3001/api/health; echo

echo "======== REDIS ========"
docker compose exec -T redis redis-cli ping
MEM=$(docker compose exec -T redis redis-cli INFO memory 2>/dev/null || true)
echo "$MEM" | grep -E 'used_memory_human|maxmemory_human|maxmemory_policy' || true
USED_BYTES=$(echo "$MEM" | awk -F: '/^used_memory:/{print $2}' | tr -d '\r')
MAX_BYTES=$(echo "$MEM" | awk -F: '/^maxmemory:/{print $2}' | tr -d '\r')
if [ -n "${USED_BYTES:-}" ] && [ "${USED_BYTES:-0}" -gt 0 ] 2>/dev/null; then
  USED_MB=$((USED_BYTES / 1024 / 1024))
  echo "used_memory_mb=${USED_MB} warn_threshold_mb=${WARN_MB}"
  if [ "$USED_MB" -ge "$WARN_MB" ]; then
    echo "ALERTA: Redis acima de ${WARN_MB} MB — investigar antes de OOM"
  fi
fi
docker compose exec -T redis redis-cli DBSIZE

echo "======== FILAS BULLMQ ========"
for Q in campaign-messages evolution-webhook; do
  W=$(docker compose exec -T redis redis-cli LLEN "bull:${Q}:wait" 2>/dev/null || echo 0)
  A=$(docker compose exec -T redis redis-cli LLEN "bull:${Q}:active" 2>/dev/null || echo 0)
  F=$(docker compose exec -T redis redis-cli ZCARD "bull:${Q}:failed" 2>/dev/null || echo 0)
  echo "bull:${Q} wait=$W active=$A failed=$F"
done

echo "======== EVOLUTION ========"
EVO_KEY=$(grep -E '^EVOLUTION_API_KEY=' .env | head -1 | cut -d= -f2- | tr -d '\r"')
HTTP=$(curl -s -o /tmp/evo-instances.json -w '%{http_code}' --max-time 15 \
  -H "apikey: $EVO_KEY" http://127.0.0.1:8080/instance/fetchInstances)
echo "fetchInstances HTTP=$HTTP bytes=$(wc -c < /tmp/evo-instances.json 2>/dev/null || echo 0)"
if [ "$HTTP" = "200" ] && [ -s /tmp/evo-instances.json ]; then
  python3 -c "
import json
d=json.load(open('/tmp/evo-instances.json'))
items=d if isinstance(d,list) else d.get('instances') or d.get('data') or []
print(f\"{'NOME':42} {'STATUS':12}\")
for i in items:
    inst=i.get('instance') or i
    n=inst.get('instanceName') or inst.get('name') or '?'
    s=inst.get('status') or inst.get('connectionStatus') or inst.get('state') or '?'
    print(f'{n:42} {s:12}')
print('Total:', len(items))
"
fi

echo "======== FIM ========"
echo "Relatório: $REPORT"
