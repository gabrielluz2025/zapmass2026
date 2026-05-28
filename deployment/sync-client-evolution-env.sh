#!/usr/bin/env bash
# Força variáveis Evolution nos .env dos clientes (demo/acme) e recria containers.
# Uso: cd /opt/zapmass && bash deployment/sync-client-evolution-env.sh
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
ENV="${ENV_PATH:-$ROOT/.env}"

log() { echo "==> $*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root." >&2
  exit 1
fi

cd "$ROOT"
EVOLUTION_KEY="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=' "$ENV" 2>/dev/null | tail -1 | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=//' | tr -d '\r"' || true)"
EVOLUTION_KEY="${EVOLUTION_KEY:-zapmass-secure-key-2026}"

set_or_replace_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"
  if grep -qE "^[[:space:]]*${key}=" "$file"; then
    sed -i -E "s|^[[:space:]]*${key}=.*|${key}=${value}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

patch_client_env() {
  local client_env="$1"
  local public_url="${2:-}"
  [ -f "$client_env" ] || return 0
  cp -a "$client_env" "${client_env}.bak.$(date +%Y%m%d%H%M%S)"
  set_or_replace_env_var "$client_env" "ZAPMASS_WHATSAPP_ENGINE" "evolution"
  set_or_replace_env_var "$client_env" "EVOLUTION_API_KEY" "$EVOLUTION_KEY"
  set_or_replace_env_var "$client_env" "EVOLUTION_API_URL" "http://172.17.0.1:8080"
  set_or_replace_env_var "$client_env" "REDIS_URL" "redis://redis:6379"
  if [ -n "$public_url" ]; then
    set_or_replace_env_var "$client_env" "ZAPMASS_WEBHOOK_URL" "${public_url%/}/webhook/evolution"
    set_or_replace_env_var "$client_env" "PUBLIC_APP_URL" "$public_url"
  fi
}

CLIENTES_DIR="$ROOT/clientes"
if [ ! -d "$CLIENTES_DIR" ]; then
  log "Nenhuma pasta clientes/ — nada a sincronizar"
  exit 0
fi

# shellcheck source=deployment/clientes/scripts/_comum.sh
. "$ROOT/deployment/clientes/scripts/_comum.sh"

for dir in "$CLIENTES_DIR"/*/; do
  [ -d "$dir" ] || continue
  slug="$(basename "$dir")"
  [[ "$slug" == *removido* ]] && continue
  [ -f "${dir}/docker-compose.yml" ] || continue
  client_env="${dir}/.env"
  pub=""
  if [ -f "$client_env" ]; then
    pub="$(grep -E '^PUBLIC_URL=' "$client_env" | tail -1 | cut -d= -f2- | tr -d '\r"' || true)"
  fi
  log "Cliente ${slug}: forçar Evolution no .env + recreate"
  patch_client_env "$client_env" "$pub"
  recriar_cliente_compose "$dir" "$slug" || echo "AVISO: falha ao recriar ${slug}" >&2
done

log "Concluído. Verifique logs: docker logs zapmass-cli-demo --tail 30"
