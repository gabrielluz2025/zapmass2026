#!/usr/bin/env bash
# fix-evolution-go-vps.sh
# =========================================================
# Diagnóstico + recuperação automática do Evolution Go
# (produção e homologação) na VPS.
#
# Uso: bash deployment/fix-evolution-go-vps.sh
#      bash deployment/fix-evolution-go-vps.sh --force-restart
#      bash deployment/fix-evolution-go-vps.sh --check-license
# =========================================================
set -euo pipefail

ZAPMASS_DIR="${ZAPMASS_DIR:-/opt/zapmass}"
FORCE_RESTART="${1:-}"
LOG_TAG="[fix-evo-go]"

ok()    { echo -e "\033[0;32m✓ $*\033[0m"; }
warn()  { echo -e "\033[0;33m⚠ $*\033[0m"; }
err()   { echo -e "\033[0;31m✗ $*\033[0m"; }
info()  { echo -e "\033[0;36mℹ $*\033[0m"; }
header(){ echo -e "\n\033[1;37m=== $* ===\033[0m"; }

cd "$ZAPMASS_DIR" || { err "Diretório $ZAPMASS_DIR não encontrado"; exit 1; }

# ─── Carrega .env (tolerante a erros de sintaxe) ─────────
if [[ -f .env ]]; then
  # Lê apenas linhas KEY=VALUE simples — ignora multi-line e sintaxe inválida
  while IFS='=' read -r key val; do
    [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
    key="${key//[[:space:]]/}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    export "$key"="$val" 2>/dev/null || true
  done < .env
fi

EVO_GO_KEY="${EVOLUTION_GO_KEY:-${EVOLUTION_API_KEY:-zapmass-secure-key-2026}}"
EVO_GO_KEY_HOMOLOG="${EVOLUTION_GO_KEY_HOMOLOG:-zapmass-homolog-key-2026}"

# ─── Função: checar container ────────────────────────────
check_container() {
  local name="$1"
  local status
  status=$(docker inspect --format='{{.State.Status}}' "$name" 2>/dev/null || echo "missing")
  echo "$status"
}

# ─── Função: checar API HTTP ─────────────────────────────
check_http() {
  local url="$1"
  local apikey="$2"
  local code
  code=$(curl -sf -o /dev/null -w "%{http_code}" \
    -H "apikey: $apikey" \
    --connect-timeout 5 --max-time 10 \
    "$url" 2>/dev/null || echo "000")
  echo "$code"
}

# ─── Função: checar licença ──────────────────────────────
check_license() {
  local url="$1"
  local apikey="$2"
  local response
  response=$(curl -sf \
    -H "apikey: $apikey" \
    --connect-timeout 5 --max-time 10 \
    "${url}/license/status" 2>/dev/null || echo '{"error":"unreachable"}')
  echo "$response"
}

# ─── Função: reiniciar + aguardar ────────────────────────
restart_and_wait() {
  local service="$1"
  local compose_file="${2:-docker-compose.yml}"
  info "Reiniciando $service..."
  docker compose -f "$compose_file" restart "$service" 2>&1 || true
  local i=0
  while [[ $i -lt 30 ]]; do
    local st
    st=$(check_container "zapmass-$service" 2>/dev/null || \
         check_container "zapmass-${service}-homolog" 2>/dev/null || echo "unknown")
    if [[ "$st" == "running" ]]; then
      ok "$service está running"
      sleep 5  # aguarda health check interno
      return 0
    fi
    sleep 2
    ((i++))
  done
  err "$service não ficou running após reinício"
  return 1
}

# ═══════════════════════════════════════════════════════════
header "DIAGNÓSTICO EVOLUTION GO — PRODUÇÃO"
# ═══════════════════════════════════════════════════════════

PROD_STATUS=$(check_container "zapmass-evolution-go")
info "Container zapmass-evolution-go: $PROD_STATUS"

case "$PROD_STATUS" in
  running)
    ok "Container está running"
    # Checar HTTP
    PROD_HTTP=$(check_http "http://127.0.0.1:8081/" "$EVO_GO_KEY")
    if [[ "$PROD_HTTP" == "200" || "$PROD_HTTP" == "404" || "$PROD_HTTP" == "401" ]]; then
      ok "API respondendo (HTTP $PROD_HTTP)"
    else
      warn "API não respondeu corretamente (HTTP $PROD_HTTP) — reiniciando..."
      restart_and_wait "evolution-go" "docker-compose.yml" || true
    fi

    # Checar licença
    if [[ "${FORCE_RESTART:-}" == "--check-license" || "${1:-}" == "--check-license" ]]; then
      header "Verificando licença produção"
      LIC=$(check_license "http://127.0.0.1:8081" "$EVO_GO_KEY")
      info "Resposta licença: $LIC"
      if echo "$LIC" | grep -qi '"active":true\|"licensed":true\|"status":"active"'; then
        ok "Licença ATIVA"
      else
        warn "Licença pode estar inativa."
        warn "Acesse: ssh -L 8081:127.0.0.1:8081 seu-user@seu-servidor"
        warn "Depois abra: http://127.0.0.1:8081/manager"
      fi
    fi
    ;;
  exited|dead|missing)
    err "Container zapmass-evolution-go está $PROD_STATUS"
    info "Tentando subir evolution-go..."
    docker compose -f docker-compose.yml up -d evolution-go 2>&1
    sleep 10
    NEW_STATUS=$(check_container "zapmass-evolution-go")
    if [[ "$NEW_STATUS" == "running" ]]; then
      ok "evolution-go subiu com sucesso!"
    else
      err "Falhou ao subir evolution-go. Status: $NEW_STATUS"
      err "Verifique: docker compose logs evolution-go --tail=50"
    fi
    ;;
  *)
    warn "Status inesperado: $PROD_STATUS"
    ;;
esac

if [[ "${FORCE_RESTART:-}" == "--force-restart" ]]; then
  warn "Force restart solicitado para produção..."
  docker compose -f docker-compose.yml restart evolution-go 2>&1
  sleep 10
  ok "evolution-go reiniciado"
fi

# ═══════════════════════════════════════════════════════════
header "DIAGNÓSTICO EVOLUTION GO — HOMOLOGAÇÃO"
# ═══════════════════════════════════════════════════════════

HOMOLOG_STATUS=$(check_container "zapmass-evolution-go-homolog")
info "Container zapmass-evolution-go-homolog: $HOMOLOG_STATUS"

case "$HOMOLOG_STATUS" in
  running)
    ok "Container homolog está running"
    HOMOLOG_HTTP=$(check_http "http://127.0.0.1:8082/" "$EVO_GO_KEY_HOMOLOG")
    if [[ "$HOMOLOG_HTTP" == "200" || "$HOMOLOG_HTTP" == "404" || "$HOMOLOG_HTTP" == "401" ]]; then
      ok "API homolog respondendo (HTTP $HOMOLOG_HTTP)"
    else
      warn "API homolog não respondeu corretamente (HTTP $HOMOLOG_HTTP) — reiniciando..."
      docker compose -f docker-compose.homolog.yml restart evolution-go-homolog 2>&1 || true
      sleep 10
    fi
    ;;
  exited|dead|missing)
    err "Container zapmass-evolution-go-homolog está $HOMOLOG_STATUS"
    info "Tentando subir evolution-go-homolog..."
    docker compose -f docker-compose.homolog.yml up -d evolution-go-homolog 2>&1
    sleep 10
    NEW_STATUS=$(check_container "zapmass-evolution-go-homolog")
    if [[ "$NEW_STATUS" == "running" ]]; then
      ok "evolution-go-homolog subiu com sucesso!"
    else
      err "Falhou ao subir evolution-go-homolog. Status: $NEW_STATUS"
      err "Verifique: docker compose -f docker-compose.homolog.yml logs evolution-go-homolog --tail=50"
    fi
    ;;
  *)
    warn "Status inesperado homolog: $HOMOLOG_STATUS"
    ;;
esac

if [[ "${FORCE_RESTART:-}" == "--force-restart" ]]; then
  warn "Force restart solicitado para homolog..."
  docker compose -f docker-compose.homolog.yml restart evolution-go-homolog 2>&1
  sleep 10
  ok "evolution-go-homolog reiniciado"
fi

# ═══════════════════════════════════════════════════════════
header "RESUMO FINAL"
# ═══════════════════════════════════════════════════════════

echo ""
info "Status atual dos containers Evolution Go:"
docker ps --filter "name=zapmass-evolution-go" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true

echo ""
info "Para ativar licença Foundation (produção):"
echo "  1. Crie um túnel SSH: ssh -L 8081:127.0.0.1:8081 <seu-user>@<seu-servidor>"
echo "  2. Abra no navegador: http://127.0.0.1:8081/manager"
echo "  3. Faça login com e-mail cadastrado na Foundation"
echo ""
info "Para ativar licença Foundation (homolog):"
echo "  1. Crie um túnel SSH: ssh -L 8082:127.0.0.1:8082 <seu-user>@<seu-servidor>"
echo "  2. Abra no navegador: http://127.0.0.1:8082/manager"
echo ""
info "Comandos de diagnóstico:"
echo "  docker compose logs evolution-go --tail=100"
echo "  docker compose -f docker-compose.homolog.yml logs evolution-go-homolog --tail=100"
echo "  curl -H 'apikey: \$EVOLUTION_GO_KEY' http://127.0.0.1:8081/license/status"
echo "  curl -H 'apikey: \$EVOLUTION_GO_KEY_HOMOLOG' http://127.0.0.1:8082/license/status"
