#!/usr/bin/env bash
# Ativa licença Evolution Go homolog sem OAuth (usa EVOLUTION_OPERATOR_EMAIL + /v1/register/auto).
# Uso: cd /opt/zapmass && bash deployment/activate-homolog-evolution-license.sh [email]
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

HOMOLOG_ENV="${ROOT}/homolog/.env"
COMPOSE_FILE="${ROOT}/docker-compose.homolog.yml"
GO_KEY="${EVOLUTION_GO_KEY_HOMOLOG:-}"
if [ -z "$GO_KEY" ] && [ -f "$HOMOLOG_ENV" ]; then
  GO_KEY="$(grep -E '^EVOLUTION_GO_KEY_HOMOLOG=' "$HOMOLOG_ENV" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"' || true)"
fi
GO_KEY="${GO_KEY:-zapmass-homolog-key-2026}"
GO_PORT="${HOMOLOG_EVOLUTION_PORT:-8082}"
EMAIL="${1:-}"

if [ -z "$EMAIL" ] && [ -f "$HOMOLOG_ENV" ]; then
  EMAIL="$(grep -E '^EVOLUTION_OPERATOR_EMAIL=' "$HOMOLOG_ENV" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"' || true)"
fi
if [ -z "$EMAIL" ] && [ -f .env ]; then
  EMAIL="$(grep -E '^EVOLUTION_OPERATOR_EMAIL=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"' || true)"
fi
if [ -z "$EMAIL" ]; then
  EMAIL="festaimportgabriel@gmail.com"
fi

log() { echo "==> $*"; }

ensure_compose_operator_email() {
  if grep -q 'EVOLUTION_OPERATOR_EMAIL:' "$COMPOSE_FILE" 2>/dev/null; then
    return 0
  fi
  log "Patch docker-compose.homolog.yml — repassar EVOLUTION_OPERATOR_EMAIL ao container…"
  sed -i '/LOGTYPE: console/a\      EVOLUTION_OPERATOR_EMAIL: ${EVOLUTION_OPERATOR_EMAIL:-}' "$COMPOSE_FILE"
}

log "Evolution Go homolog — ativação licença (sem OAuth)"
log "E-mail operador: ${EMAIL}"

STATUS_JSON="$(curl -sf -H "apikey: ${GO_KEY}" "http://127.0.0.1:${GO_PORT}/license/status" 2>/dev/null || echo '{}')"
INSTANCE_ID="$(echo "$STATUS_JSON" | sed -n 's/.*"instance_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
LICENSE_STATUS="$(echo "$STATUS_JSON" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"

if [ "$LICENSE_STATUS" = "active" ]; then
  log "Licença já ATIVA em :${GO_PORT}"
  curl -sf -H "apikey: ${GO_KEY}" "http://127.0.0.1:${GO_PORT}/instance/all" | head -c 200 || true
  echo ""
  exit 0
fi

if [ -z "$INSTANCE_ID" ]; then
  echo "ERRO: Evolution Go homolog não responde em :${GO_PORT} — suba o container primeiro." >&2
  exit 1
fi

log "instance_id=${INSTANCE_ID}"

log "Prod (:8081) license/status (referência)…"
PROD_KEY="$(grep -E '^EVOLUTION_GO_KEY=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"' || true)"
PROD_KEY="${PROD_KEY:-$(grep -E '^EVOLUTION_API_KEY=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"' || true)}"
if [ -n "$PROD_KEY" ]; then
  curl -s -H "apikey: ${PROD_KEY}" "http://127.0.0.1:8081/license/status" 2>/dev/null | head -c 300 || true
  echo ""
fi

log "Tentativa 1: EVOLUTION_OPERATOR_EMAIL + recreate container…"
ensure_compose_operator_email
mkdir -p "$(dirname "$HOMOLOG_ENV")"
if grep -q '^EVOLUTION_OPERATOR_EMAIL=' "$HOMOLOG_ENV" 2>/dev/null; then
  sed -i "s/^EVOLUTION_OPERATOR_EMAIL=.*/EVOLUTION_OPERATOR_EMAIL=${EMAIL}/" "$HOMOLOG_ENV"
else
  echo "EVOLUTION_OPERATOR_EMAIL=${EMAIL}" >> "$HOMOLOG_ENV"
fi

export EVOLUTION_OPERATOR_EMAIL="${EMAIL}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(grep -E '^POSTGRES_PASSWORD=' "$HOMOLOG_ENV" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"' || true)}"
docker compose -f "$COMPOSE_FILE" --env-file "$HOMOLOG_ENV" up -d --force-recreate --no-deps evolution-go-homolog
sleep 15

STATUS_JSON="$(curl -sf -H "apikey: ${GO_KEY}" "http://127.0.0.1:${GO_PORT}/license/status" 2>/dev/null || echo '{}')"
LICENSE_STATUS="$(echo "$STATUS_JSON" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
if [ "$LICENSE_STATUS" = "active" ]; then
  log "OK — licença ativa após recreate"
  exit 0
fi

license_active_with_key() {
  local key="$1"
  local json
  json="$(curl -sf -H "apikey: ${key}" "http://127.0.0.1:${GO_PORT}/license/status" 2>/dev/null || echo '{}')"
  echo "$json" | grep -qiE '"status"[[:space:]]*:[[:space:]]*"active"'
}

set_homolog_go_key() {
  local api_key="$1"
  mkdir -p "$(dirname "$HOMOLOG_ENV")"
  if grep -q '^EVOLUTION_GO_KEY_HOMOLOG=' "$HOMOLOG_ENV" 2>/dev/null; then
    sed -i "s/^EVOLUTION_GO_KEY_HOMOLOG=.*/EVOLUTION_GO_KEY_HOMOLOG=${api_key}/" "$HOMOLOG_ENV"
  else
    echo "EVOLUTION_GO_KEY_HOMOLOG=${api_key}" >> "$HOMOLOG_ENV"
  fi
  GO_KEY="${api_key}"
  export EVOLUTION_GO_KEY_HOMOLOG="${api_key}"
}

bootstrap_license_via_global_api_key() {
  local api_key="$1"
  if [ -z "$api_key" ]; then
    return 1
  fi
  log "Bootstrap: GLOBAL_API_KEY = api_key da Foundation (validação no boot)…"
  set_homolog_go_key "$api_key"
  export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(grep -E '^POSTGRES_PASSWORD=' "$HOMOLOG_ENV" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"' || true)}"
  docker compose -f "$COMPOSE_FILE" --env-file "$HOMOLOG_ENV" up -d --force-recreate --no-deps evolution-go-homolog zapmass-homolog
  sleep 20
  if license_active_with_key "$api_key"; then
    log "OK — licença ATIVA (bootstrap GLOBAL_API_KEY)"
    curl -sf -H "apikey: ${api_key}" "http://127.0.0.1:${GO_PORT}/instance/all" | head -c 200 || true
    echo ""
    return 0
  fi
  return 1
}

persist_license_in_container() {
  local api_key="$1"
  if [ -z "$api_key" ]; then
    return 1
  fi
  if bootstrap_license_via_global_api_key "$api_key"; then
    return 0
  fi
  log "Fallback: GET /license/activate?code=… (Go pode não aceitar api_key direta)"
  ACTIVATE_RESP="$(curl -s "http://127.0.0.1:${GO_PORT}/license/activate?code=${api_key}" 2>/dev/null || true)"
  echo "$ACTIVATE_RESP" | head -c 400
  echo ""
  sleep 3
  if license_active_with_key "$GO_KEY"; then
    log "OK — licença ATIVA no container :${GO_PORT}"
    curl -sf -H "apikey: ${GO_KEY}" "http://127.0.0.1:${GO_PORT}/instance/all" | head -c 200 || true
    echo ""
    return 0
  fi
  return 1
}

log "Tentativa 2: POST /v1/register/auto (Foundation)…"
AUTO_RESP=""
LICENSE_API_KEY=""
for spec in "community:2.4.0" "community:0.7.2" "go:0.7.2"; do
  tier="${spec%%:*}"
  ver="${spec#*:}"
  log "  register/auto tier=${tier} version=${ver}…"
  AUTO_RESP="$(curl -s -X POST "https://license.evolutionfoundation.com.br/v1/register/auto" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${EMAIL}\",\"tier\":\"${tier}\",\"version\":\"${ver}\",\"instance_id\":\"${INSTANCE_ID}\"}" || true)"
  echo "$AUTO_RESP" | head -c 400
  echo ""
  LICENSE_API_KEY="$(echo "$AUTO_RESP" | sed -n 's/.*"api_key"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  if echo "$AUTO_RESP" | grep -qiE '"status"[[:space:]]*:[[:space:]]*"active"|"api_key"'; then
    break
  fi
done

if [ -n "$LICENSE_API_KEY" ]; then
  if persist_license_in_container "$LICENSE_API_KEY"; then
    exit 0
  fi
  log "register/auto OK na Foundation, mas container não persistiu — recriando e tentando /license/activate de novo…"
  ensure_compose_operator_email
  export EVOLUTION_OPERATOR_EMAIL="${EMAIL}"
  docker compose -f "$COMPOSE_FILE" --env-file "$HOMOLOG_ENV" up -d --force-recreate --no-deps evolution-go-homolog
  sleep 15
  if persist_license_in_container "$LICENSE_API_KEY"; then
    exit 0
  fi
fi

if echo "$AUTO_RESP" | grep -qi 'CUSTOMER_NOT_FOUND'; then
  log "E-mail ainda não registrado na Foundation — use Magic Link (NÃO Google/GitHub):"
  echo ""
  REGISTER_JSON="$(curl -s -X POST "https://license.evolutionfoundation.com.br/v1/register/init" \
    -H "Content-Type: application/json" \
    -d "{\"tier\":\"community\",\"version\":\"2.4.0\",\"instance_id\":\"${INSTANCE_ID}\"}" || true)"
  REGISTER_URL="$(echo "$REGISTER_JSON" | sed -n 's/.*"register_url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  if [ -n "$REGISTER_URL" ]; then
    echo "  Abra no browser (túnel SSH -L 8082 ativo opcional):"
    echo "  ${REGISTER_URL}"
  else
    echo "  http://127.0.0.1:${GO_PORT}/manager/login"
  fi
  echo ""
  echo "  Na página de registro:"
  echo "  - NÃO clique em Google nem GitHub (OAuth está com erro no servidor deles)"
  echo "  - Use apenas Magic Link: nome + ${EMAIL} → receber link no e-mail"
  echo "  - Depois de confirmar o e-mail, rode de novo:"
  echo "    bash deployment/activate-homolog-evolution-license.sh ${EMAIL}"
  exit 1
fi

echo ""
log "Falhou — veja resposta acima. OAuth Google/GitHub da Foundation pode estar indisponível."
log "Alternativa: suporte@evofoundation.com.br ou portal https://license.evolutionfoundation.com.br/portal"
exit 1
