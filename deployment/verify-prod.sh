#!/usr/bin/env bash
# Verificação pós-deploy na VPS (health, commit, serviços Swarm).
# Uso na VPS:   bash /opt/zapmass/deployment/verify-prod.sh
# Ou remoto:    ssh user@IP 'bash -s' < deployment/verify-prod.sh
set -euo pipefail

REPO="${ZAPMASS_ROOT:-/opt/zapmass}"
cd "$REPO" 2>/dev/null || { echo "ERRO: pasta $REPO não encontrada."; exit 1; }

echo "=== ZapMass — verificação rápida ==="
echo "Data (UTC): $(date -u '+%Y-%m-%d %H:%M:%S')"
echo

echo "==> Commit no disco (deve bater com o deploy recente)"
git rev-parse --short HEAD 2>/dev/null || echo "(sem git)"
echo

echo "==> GET http://127.0.0.1:3001/api/health"
code="$(curl -s -o /tmp/zm-h.json -w '%{http_code}' http://127.0.0.1:3001/api/health || echo 000)"
echo "HTTP $code"
if [ "$code" = "200" ] && [ -f /tmp/zm-h.json ]; then
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import json,sys; d=json.load(open('/tmp/zm-h.json')); print(json.dumps(d, indent=2, ensure_ascii=False))" 2>/dev/null || cat /tmp/zm-h.json
  else
    cat /tmp/zm-h.json
  fi
  echo
  if grep -q 'mercadopagoConfigured' /tmp/zm-h.json 2>/dev/null; then
    echo "OK: resposta JSON de health (verifica mercadopagoConfigured acima)."
  fi
else
  echo "FALHA: API não respondeu 200. Veja: docker service logs --tail 50 zapmass_api"
fi
echo

if [ -f "$REPO/.env" ]; then
  if grep -qE '^[[:space:]]*WWEBJS_WEB_VERSION_URL[[:space:]]*=' "$REPO/.env" 2>/dev/null; then
    echo "==> .env raiz: WWEBJS_WEB_VERSION_URL definida."
  else
    echo "AVISO: .env raiz sem WWEBJS_WEB_VERSION_URL — veja deployment/wwebjs-default-bundle.env e clientes/scripts/aplicar-wwebjs-bundle.sh"
  fi
fi
echo

if docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q active; then
  echo "==> Docker Swarm — serviço zapmass_api (última tarefa)"
  docker service ps zapmass_api --no-trunc 2>/dev/null | head -5 || true
  echo
else
  echo "==> Docker Compose (não-Swarm)"
  docker compose -f "$REPO/docker-compose.yml" ps 2>/dev/null || true
  echo
fi

echo "=== Próximo passo (só você no browser) ==="
echo "1) Abra o site em janela anónima e faça login."
echo "2) Confira o build/commit na UI (Configurações) com o commit: $(git rev-parse --short HEAD 2>/dev/null || echo '?')"
echo "3) Teste checkout Mercado Pago se for crítico (abrir link basta)."
