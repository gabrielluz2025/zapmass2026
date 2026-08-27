#!/usr/bin/env bash
# Deploy só do ambiente de homologação (não reinicia produção).
# Uso: cd /opt/zapmass && bash deployment/vps-deploy-homolog.sh
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

# Sempre alinhar com origin/develop antes do build (CI usa checkout -f do SHA do workflow).
sync_git_develop() {
  if [ -f deployment/ensure-git-develop.sh ]; then
    chmod +x deployment/ensure-git-develop.sh 2>/dev/null || true
    bash deployment/ensure-git-develop.sh
    return
  fi
  echo "==> ensure-git-develop.sh ausente — sync inline (fetch + reset --hard)…"
  git fetch origin develop --prune
  if ! git show-ref -q --verify refs/remotes/origin/develop; then
    echo "ERRO: origin/develop não encontrado após fetch." >&2
    exit 1
  fi
  if git show-ref -q --verify refs/heads/develop; then
    git checkout -f develop
  else
    git checkout -b develop origin/develop
  fi
  git reset --hard origin/develop
  echo "==> develop @ $(git rev-parse --short HEAD)"
}

if [ "${SKIP_GIT_SYNC:-0}" != "1" ]; then
  if [ -n "${GITHUB_ACTIONS:-}" ] && [ -n "${GHA_SHA:-}" ]; then
    git fetch --all --prune
    git checkout -f "${GHA_SHA}"
  else
    sync_git_develop
  fi
fi

HOMOLOG_DIR="${ROOT}/homolog"
COMPOSE_FILE="${ROOT}/docker-compose.homolog.yml"
LOCK="/var/lock/zapmass-homolog-deploy.lock"

read_env_val() {
  local file="$1" key="$2"
  grep -E "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

event="${GITHUB_EVENT_NAME:-manual}"
if [ -z "${GITHUB_ACTIONS:-}" ] && [ "$event" = "push" ]; then
  event="manual"
fi

# shellcheck source=deployment/deploy-window.sh
. "$(dirname "$0")/deploy-window.sh"
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

docker compose up -d postgres redis 2>/dev/null || true

VITE_GIT_REF="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
export VITE_GIT_REF
export BUILDKIT_MAX_PARALLELISM="${BUILDKIT_MAX_PARALLELISM:-1}"

while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%$'\r'}"
  case "$line" in
    ''|'#'*) continue ;;
    *=*)
      key="${line%%=*}"
      val="${line#*=}"
      case "$key" in
        HOMOLOG_*|EVOLUTION_GO_KEY_HOMOLOG|EVOLUTION_OPERATOR_EMAIL|ZAPMASS_HOMOLOG_*|POSTGRES_PASSWORD|ZAPMASS_SHARED_NETWORK|VITE_*|GEMINI_*|RESEND_*|EMAIL_*|ADMIN_*|ZAPMASS_ADMIN_*)
          export "${key}=${val}"
          ;;
      esac
      ;;
  esac
done < "${HOMOLOG_DIR}/.env"

if [ -z "${POSTGRES_PASSWORD:-}" ] && [ -f "${ROOT}/.env" ]; then
  POSTGRES_PASSWORD="$(read_env_val "${ROOT}/.env" POSTGRES_PASSWORD)"
  export POSTGRES_PASSWORD
fi

echo "==> homolog deploy commit=${VITE_GIT_REF} event=${event}"

EXPECTED_REMOTE="$(git rev-parse --short origin/develop 2>/dev/null || echo '')"
if [ -n "${EXPECTED_REMOTE}" ] && [ "${VITE_GIT_REF}" != "${EXPECTED_REMOTE}" ]; then
  echo "ERRO: HEAD=${VITE_GIT_REF} mas origin/develop=${EXPECTED_REMOTE}." >&2
  echo "      Rode: cd /opt/zapmass && git fetch origin develop && git reset --hard origin/develop" >&2
  exit 1
fi

if [ -f deployment/fix-postgres-connections.sh ]; then
  chmod +x deployment/fix-postgres-connections.sh 2>/dev/null || true
  bash deployment/fix-postgres-connections.sh --aggressive || {
    echo "AVISO: limpeza Postgres falhou — tentando restart…" >&2
    bash deployment/fix-postgres-connections.sh --aggressive --restart-postgres || true
  }
fi

docker compose -f "$COMPOSE_FILE" --env-file "${HOMOLOG_DIR}/.env" build zapmass-homolog
docker compose -f "$COMPOSE_FILE" --env-file "${HOMOLOG_DIR}/.env" up -d --no-deps zapmass-homolog

if [ -f deployment/recover-homolog-evolution-go.sh ]; then
  chmod +x deployment/recover-homolog-evolution-go.sh 2>/dev/null || true
  bash deployment/recover-homolog-evolution-go.sh || echo "AVISO: Evolution Go homolog com problema — chips WhatsApp em homolog indisponíveis até corrigir."
fi

PORT="${HOMOLOG_HOST_PORT:-3200}"
echo "==> aguardando health homolog (:${PORT})..."
ok=0
for i in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/health" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    ver="$(curl -sf "http://127.0.0.1:${PORT}/api/health" 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || true)"
    echo "==> homolog OK version=${ver:-?} env=homolog (commit=${VITE_GIT_REF})"
    if [ -n "${ver}" ] && [ "${ver}" != "${VITE_GIT_REF}" ] && [ "${ver}" != "$(git rev-parse HEAD 2>/dev/null)" ]; then
      echo "ERRO: API ainda em ${ver}, esperado ${VITE_GIT_REF}. Rebuild sem cache:" >&2
      echo "  docker compose -f ${COMPOSE_FILE} --env-file ${HOMOLOG_DIR}/.env build --no-cache zapmass-homolog" >&2
      exit 1
    fi
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
