#!/usr/bin/env bash
# Diagnóstico e limpeza leve de filas BullMQ no Redis (sem FLUSHDB).
# Uso: cd /opt/zapmass && bash deployment/trim-redis-bullmq.sh
# O trim automático roda no servidor via startBullmqMaintenance(); este script é fallback ops.
set -euo pipefail
cd /opt/zapmass || { echo "ERRO: /opt/zapmass não existe"; exit 1; }

echo "======== REDIS MEMORY ========"
docker compose exec -T redis redis-cli INFO memory | grep -E 'used_memory_human|maxmemory_human|maxmemory_policy|mem_fragmentation_ratio' || true

echo "======== DBSIZE (todas as DBs compartilham maxmemory) ========"
for DB in 0 1 2; do
  SZ=$(docker compose exec -T redis redis-cli -n "$DB" DBSIZE 2>/dev/null | tr -d '\r' || echo '?')
  echo "DB $DB keys=$SZ (0=BullMQ ZapMass, 1=Evolution cache)"
done

echo "======== FILAS BULLMQ (DB 0) ========"
for Q in campaign-messages evolution-webhook; do
  W=$(docker compose exec -T redis redis-cli -n 0 LLEN "bull:${Q}:wait" 2>/dev/null | tr -d '\r' || echo 0)
  A=$(docker compose exec -T redis redis-cli -n 0 LLEN "bull:${Q}:active" 2>/dev/null | tr -d '\r' || echo 0)
  D=$(docker compose exec -T redis redis-cli -n 0 ZCARD "bull:${Q}:delayed" 2>/dev/null | tr -d '\r' || echo 0)
  F=$(docker compose exec -T redis redis-cli -n 0 ZCARD "bull:${Q}:failed" 2>/dev/null | tr -d '\r' || echo 0)
  C=$(docker compose exec -T redis redis-cli -n 0 ZCARD "bull:${Q}:completed" 2>/dev/null | tr -d '\r' || echo 0)
  echo "bull:${Q} wait=$W active=$A delayed=$D failed=$F completed_zset=$C"
done

echo "======== HEALTH DEEP (métricas app) ========"
curl -sf --max-time 15 http://127.0.0.1:3001/api/health/deep 2>/dev/null | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    r=d.get('redis',{})
    m=r.get('memory') or {}
    print('redis.ok=', r.get('ok'), 'used=', m.get('usedMemoryHuman'), 'max=', m.get('maxMemoryHuman'), 'pct=', m.get('usedPct'), 'warn=', m.get('warn'))
    print('evolution-webhook=', d.get('evolutionWebhookQueue'))
    print('campaign-messages=', d.get('campaignBullmqQueue'))
except Exception as e:
    print('health/deep indisponível:', e)
" || echo "(requer METRICS_TOKEN ou rede local)"

echo ""
echo "Se used_memory perto de maxmemory:"
echo "  1. Confirme REDIS_MAXMEMORY=2gb no .env e recrie o container redis"
echo "  2. POST /api/health/dispatch/reconnect (recria workers BullMQ)"
echo "  3. Reinicie zapmass após deploy com bullmqRetention (trim automático a cada 30 min)"
