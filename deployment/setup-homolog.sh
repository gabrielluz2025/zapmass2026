#!/usr/bin/env bash
# Instala ambiente de homologação na mesma VPS (uma vez).
# Uso: cd /opt/zapmass && sudo bash deployment/setup-homolog.sh
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

DOMAIN="${HOMOLOG_DOMAIN:-homolog.zap-mass.com}"
HOST_PORT="${HOMOLOG_HOST_PORT:-3200}"
HOMOLOG_DIR="${ROOT}/homolog"
TEMPLATE="${ROOT}/deployment/homolog/homolog.env.template"
NGINX_TEMPLATE="${ROOT}/deployment/homolog/nginx-homolog.conf.template"
NGINX_FILE="/etc/nginx/sites-available/zapmass-homolog"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
  die "Execute como root: sudo bash deployment/setup-homolog.sh"
fi

if [ "${SKIP_GIT_SYNC:-0}" != "1" ] && [ -f deployment/ensure-git-develop.sh ]; then
  log "Alinhar código com origin/develop (descarta edits locais em ficheiros rastreados)..."
  bash deployment/ensure-git-develop.sh
fi

[ -f "$TEMPLATE" ] || die "Template não encontrado em ${ROOT}. Rode: bash deployment/ensure-git-develop.sh"

chmod +x deployment/ensure-homolog-dbs.sh deployment/vps-deploy-homolog.sh 2>/dev/null || true

log "Garantir postgres + redis da stack principal..."
docker compose up -d postgres redis 2>/dev/null || docker compose up -d postgres redis evolution-go || true
sleep 3

log "Criar bases Postgres de homologação..."
bash deployment/ensure-homolog-dbs.sh

mkdir -p "$HOMOLOG_DIR"
chmod 750 "$HOMOLOG_DIR"

if [ ! -f "${HOMOLOG_DIR}/.env" ]; then
  log "Criar ${HOMOLOG_DIR}/.env"
  PG_PASS="$(grep -E '^POSTGRES_PASSWORD=' "${ROOT}/.env" 2>/dev/null | tail -1 | sed -E 's/^POSTGRES_PASSWORD=//' | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' || echo 'evolution-secure-pass-2026')"
  JWT="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 64 | head -1)"
  cp "$TEMPLATE" "${HOMOLOG_DIR}/.env"
  sed -i "s|SUBSTITUA_PELO_MESMO_DA_VPS|${PG_PASS}|g" "${HOMOLOG_DIR}/.env"
  sed -i "s|postgresql://postgres:SUBSTITUA@|postgresql://postgres:${PG_PASS}@|g" "${HOMOLOG_DIR}/.env"
  sed -i "s|SUBSTITUA_GERE_NOVO_SECRET|${JWT}|g" "${HOMOLOG_DIR}/.env"
  chmod 600 "${HOMOLOG_DIR}/.env"
else
  log "${HOMOLOG_DIR}/.env já existe — mantendo."
fi

# shellcheck disable=SC1091
set -a
source "${HOMOLOG_DIR}/.env"
set +a

if [ -f "${ROOT}/deployment/clientes/scripts/setup-nginx-rate-limit.sh" ]; then
  bash "${ROOT}/deployment/clientes/scripts/setup-nginx-rate-limit.sh" || true
fi

log "Configurar Nginx → ${DOMAIN} (:${HOST_PORT})"
if [ -f "$NGINX_TEMPLATE" ]; then
  tmp="$(mktemp)"
  sed "s|{{DOMAIN}}|${DOMAIN}|g; s|{{HOST_PORT}}|${HOST_PORT}|g" "$NGINX_TEMPLATE" > "$tmp"
  mv "$tmp" "$NGINX_FILE"
  ln -sf "$NGINX_FILE" "/etc/nginx/sites-enabled/zapmass-homolog"
  nginx -t
  systemctl reload nginx
fi

if command -v certbot >/dev/null 2>&1; then
  log "Certificado SSL Let's Encrypt..."
  if certbot certificates 2>/dev/null | grep -qF "${DOMAIN}"; then
    certbot install --cert-name "${DOMAIN}" --nginx --non-interactive 2>/dev/null || \
      certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --redirect \
        -m "${ZAPMASS_CERTBOT_EMAIL:-admin@zap-mass.com}" || \
      log "AVISO: certbot install falhou — nginx já tem vhost? Teste: curl -I https://${DOMAIN}/api/health"
  else
    certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --redirect \
      -m "${ZAPMASS_CERTBOT_EMAIL:-admin@zap-mass.com}" 2>/dev/null || \
      log "AVISO: certbot falhou — confirme DNS para ${DOMAIN}."
  fi
  nginx -t && systemctl reload nginx
fi

log "Primeiro deploy homolog..."
export GITHUB_EVENT_NAME=manual
bash deployment/vps-deploy-homolog.sh

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Homologação instalada                                       ║"
echo "║  URL:  https://${DOMAIN}                                     "
echo "║  Porta local: ${HOST_PORT} · Evolution Go: 8082               "
echo "║  Deploy: bash deployment/vps-deploy-homolog.sh                 ║"
echo "║  Branch CI: develop → .github/workflows/deploy-homolog.yml     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
