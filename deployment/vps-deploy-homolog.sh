#!/usr/bin/env bash
# Deploy só do ambiente de homologação (não reinicia produção).
# Uso: cd /opt/zapmass && bash deployment/vps-deploy-homolog.sh
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

HOMOLOG_DIR="${ROOT}/homolog"
COMPOSE_FILE="${ROOT}/docker-compose.homolog.yml"
LOCK="/var/lock/zapmass-homolog-deploy.lock"

event="${GITHUB_EVENT_NAME:-manual}"
if [ -z "${GITHUB_ACTIONS:-}" ] && [ "$event" = "push" ]; then
  event="manual"
fi

# shellcheck source=deployment/deploy-window.sh
. "$(dirname "$0")/deploy-window.sh"
# Homolog pode deployar a qualquer hora (chips de teste).
if [ "$event" = "schedule" ] && ! deploy_window_active; then
  echo "==> Cron homolog fora da janela — ignorado."
  exit 0
fi

mkdir -p /var/lock "$(dirname "$LOCK")" 2>/dev/null || true
exec 9>"${LOCK}"
if ! flock -n 9; then
  echo "==> Outro deploy homolog em andamento — aguardando..."
  flock 9
fi

[ -f "$COMPOSE_FILE" ] || { echo "ERRO: ${COMPOSE_FILE} não encontrado"; exit 1; }
[ -f "${HOMOLOG_DIR}/.env" ] || {
  echo "ERRO: ${HOMOLOG_DIR}/.env ausente — rode: sudo bash deployment/setup-homolog.sh"
  exit 1
}

bash deployment/ensure-homolog-dbs.sh

# Garante rede partilhada com postgres/redis
docker compose up -d postgres redis 2>/dev/null || true

VITE_GIT_REF="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
export VITE_GIT_REF
export BUILDKIT_MAX_PARALLELISM="${BUILDKIT_MAX_PARALLELISM:-1}"

# Carrega vars do homolog/.env para interpolar compose + build Vite
while IFS='=' read -r k v; do
  k="${k//$'\r'/}"
  v="${v//$'\r'/}"
  v="${v#\"}"; v="${v%\"}"; v="${v#\'}"; v="${v%\'}"
  [ -z "$k" ] && continue
  case "$k" in
    \#*) continue ;;
    HOMOLOG_*|EVOLUTION_GO_KEY_HOMOLOG|ZAPMASS_HOMOLOG_*|POSTGRES_PASSWORD|ZAPMASS_SHARED_NETWORK|VITE_*|GEMINI_*|RESEND_*|EMAIL_*|ADMIN_*|ZAPMASS_ADMIN_*)
      export "$k=$v"
      ;;
  esac
done < "${HOMOLOG_DIR}/.env"

# Repassa senha postgres da stack principal se não estiver no homolog/.env
if [ -z "${POSTGRES_PASSWORD:-}" ] && [ -f "${ROOT}/.env" ]; then
  POSTGRES_PASSWORD="$(grep -E '^POSTGRES_PASSWORD=' "${ROOT}/.env" | tail -1 | sed -E 's/^POSTGRES_PASSWORD=//' | tr -d '\r"\'')"
  export POSTGRES_PASSWORD
fi

echo "==> homolog deploy commit=${VITE_GIT_REF} event=${event}"

docker compose -f "$COMPOSE_FILE" --env-file "${HOMOLOG_DIR}/.env" build zapmass-homolog
docker compose -f "$COMPOSE_FILE" --env-file "${HOMOLOG_DIR}/.env" up -d --no-deps evolution-go-homolog
sleep 3
docker compose -f "$COMPOSE_FILE" --env-file "${HOMOLOG_DIR}/.env" up -d --no-deps zapmass-homolog

PORT="${HOMOLOG_HOST_PORT:-3200}"
echo "==> aguardando health homolog (:${PORT})..."
ok=0
for i in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/health" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    ver="$(curl -sf "http://127.0.0.1:${PORT}/api/health" 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || true)"
    echo "==> homolog OK version=${ver:-?} env=homolog"
    ok=1
    break
  fi
  sleep 3
done

if [ "$ok" != "1" ]; then
  echo "ERRO: homolog não respondeu em :${PORT}" >&2
  docker compose -f "$COMPOSE_FILE" logs --tail=60 zapmass-homolog 2>/dev/null || true
  exit 1
fi

echo "==> homolog deploy concluído"
