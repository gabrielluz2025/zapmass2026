#!/usr/bin/env bash
# Desbloqueio emergencial de proteção de chips e circuit breaker
# Execute na VPS: bash deployment/unlock-campaign-protection.sh
set -euo pipefail

cd /opt/zapmass 2>/dev/null || { echo "Erro: /opt/zapmass não encontrado."; exit 1; }

echo "==> Liberando chipProtectionLockUntil e reconnect_storm no banco..."
docker compose exec -T postgres psql -U zapmass -d zapmass -c "
  UPDATE zapmass.tenant_dispatch_settings
     SET doc = jsonb_set(
           jsonb_set(doc, '{chipProtectionLockUntil}', '\"\"', true),
           '{chipProtectionLockReason}', '\"\"', true
         )
   WHERE (doc->>'chipProtectionLockUntil') IS NOT NULL
     AND (doc->>'chipProtectionLockUntil') <> '';
  SELECT tenant_id,
         doc->>'chipProtectionLockUntil' AS lock_until,
         doc->>'chipProtectionLockReason' AS lock_reason
    FROM zapmass.tenant_dispatch_settings
   WHERE doc ? 'chipProtectionLockUntil'
   LIMIT 20;
"

echo ""
echo "==> Limpando circuit breaker no Redis (chip:cb:* keys)..."
REDIS_KEYS=$(docker compose exec -T redis redis-cli KEYS 'chip:cb:*' 2>/dev/null | tr -d '\r')
if [ -n "$REDIS_KEYS" ]; then
  COUNT=$(echo "$REDIS_KEYS" | wc -l)
  echo "$REDIS_KEYS" | xargs docker compose exec -T redis redis-cli DEL 2>/dev/null || true
  echo "   Removidas $COUNT chaves Redis do circuit breaker."
else
  echo "   Nenhuma chave chip:cb:* encontrada no Redis."
fi

echo ""
echo "==> Status dos chips/conexões no Redis após limpeza:"
docker compose exec -T redis redis-cli KEYS 'chip:cb:*' 2>/dev/null | head -5 || echo "   (vazio)"

echo ""
echo "==> Limpando reconnect storm events no Redis..."
STORM_KEYS=$(docker compose exec -T redis redis-cli KEYS 'reconnect:storm:*' 2>/dev/null | tr -d '\r')
if [ -n "$STORM_KEYS" ]; then
  echo "$STORM_KEYS" | xargs docker compose exec -T redis redis-cli DEL 2>/dev/null || true
  echo "   Chaves de storm removidas."
else
  echo "   Nenhuma chave reconnect:storm:* encontrada."
fi

echo ""
echo "==> Reiniciando container zapmass para limpar cache em memória..."
docker compose restart zapmass
sleep 5
echo "   zapmass reiniciado."

echo ""
echo "==> Status final:"
docker compose ps --format 'table {{.Name}}\t{{.Status}}' | grep -E 'zapmass|evolution'

echo ""
echo "✓ Proteção liberada!"
echo ""
echo "Próximos passos:"
echo "  1. Acesse a aba 'Conexões → Proteção automática de chips' e confirme que o lock foi removido."
echo "  2. Vá em 'Campanhas' e clique 'Iniciar' nas campanhas pausadas."
echo "  3. Se o botão 'Liberar proteção agora' ainda aparecer, clique nele na UI."
