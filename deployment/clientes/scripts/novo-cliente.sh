#!/usr/bin/env bash
# Plano B — provisiona instância isolada por cliente (container + DB + Redis + Nginx + SSL).
#
# USO:
#   sudo bash novo-cliente.sh <slug> [--dominio dominio.com] [--sem-ssl] [--tier starter|pro|business]
#
# EXEMPLOS:
#   sudo bash novo-cliente.sh acme
#   sudo bash novo-cliente.sh acme --dominio whatsapp.acme.com --tier pro

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"

exigir_root

SLUG_RAW="${1:-}"
if [ -z "$SLUG_RAW" ]; then
    err "Uso: $0 <slug> [--dominio dominio.com] [--sem-ssl] [--tier starter|pro|business]"
    exit 2
fi
shift || true

DOMINIO=""
DOMINIO_RAIZ="${ZAPMASS_DOMINIO_RAIZ:-zap-mass.com}"
USAR_SSL=1
TIER="starter"

while [ $# -gt 0 ]; do
    case "$1" in
        --dominio|-d)
            DOMINIO="${2:-}"; shift 2;;
        --sem-ssl)
            USAR_SSL=0; shift;;
        --tier|-t)
            TIER="${2:-starter}"; shift 2;;
        *)
            err "Opção desconhecida: $1"; exit 2;;
    esac
done

case "$TIER" in
    starter|pro|business) ;;
    *) err "Tier inválido: $TIER (use starter, pro ou business)"; exit 2;;
esac

SLUG="$(normalizar_slug "$SLUG_RAW")"
if [ -z "$DOMINIO" ]; then DOMINIO="${SLUG}.${DOMINIO_RAIZ}"; fi

log "Plano B — cliente ${C_BOLD}${SLUG}${C_END} (${TIER}) → ${C_BOLD}${DOMINIO}${C_END}"

if cliente_existe "$SLUG"; then
    err "Cliente '$SLUG' já existe. Use migrar-cliente-plano-b.sh para atualizar ou remover-cliente.sh."
    exit 1
fi

if [ ! -f "${TEMPLATES_DIR}/docker-compose.cliente.yml.template" ]; then
    err "Templates em ${TEMPLATES_DIR} não encontrados. Execute git pull em ${ZAPMASS_ROOT}."
    exit 1
fi

SHARED_NET="$(compose_shared_network)"
if [ -z "$SHARED_NET" ]; then
    warn "Stack principal ausente — a subir redis/postgres/evolution..."
    (cd "$ZAPMASS_ROOT" && docker compose up -d redis postgres evolution zapmass 2>/dev/null || docker compose up -d)
    sleep 5
    SHARED_NET="$(compose_shared_network)"
fi
if [ -z "$SHARED_NET" ]; then
    err "Rede zapmass_default não encontrada. Execute: cd ${ZAPMASS_ROOT} && docker compose up -d"
    exit 1
fi

if ! docker image inspect zapmass-zapmass:latest >/dev/null 2>&1; then
    log "Imagem zapmass-zapmass:latest ausente — build em ${ZAPMASS_ROOT}..."
    (cd "$ZAPMASS_ROOT" && docker compose build)
fi

bash "${SELF_DIR}/setup-nginx-rate-limit.sh" || warn "Rate limit Nginx não configurado (opcional)."

PORTA="$(proxima_porta_livre)"
BACKUP_KEY="$(gerar_chave)"
REDIS_DB="$(proximo_redis_db)"
DB_NAME="$(db_name_para_slug "$SLUG")"
POSTGRES_PASSWORD="$(ler_postgres_password)"
EVOLUTION_API_KEY="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=' "${ZAPMASS_ROOT}/.env" 2>/dev/null | tail -1 | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=//' | tr -d '\r"' || true)"
EVOLUTION_API_KEY="${EVOLUTION_API_KEY:-zapmass-secure-key-2026}"
WWEBJS_URL="$(ler_wwebjs_bundle_url)"
tier_recursos "$TIER"

DIR="$(cliente_dir "$SLUG")"
DATA_DIR="$(cliente_data "$SLUG")"

log "Porta ${PORTA} · Redis DB ${REDIS_DB} · Postgres ${DB_NAME} · RAM ${MEM_LIMIT}"

mkdir -p "$DIR" "$DATA_DIR" "${ZAPMASS_ROOT}/backups"
chown -R root:root "$DIR"
chmod 750 "$DIR"

ensure_client_database "$DB_NAME"

render_template \
    "${TEMPLATES_DIR}/cliente.env.template" \
    "${DIR}/.env" \
    "SLUG=${SLUG}" \
    "DOMAIN=${DOMINIO}" \
    "BACKUP_KEY=${BACKUP_KEY}" \
    "EVOLUTION_API_KEY=${EVOLUTION_API_KEY}" \
    "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}" \
    "DB_NAME=${DB_NAME}" \
    "REDIS_DB=${REDIS_DB}" \
    "TIER=${TIER}" \
    "WWEBJS_WEB_VERSION_URL=${WWEBJS_URL}"

printf '\nHOST_PORT=%s\n' "$PORTA" >> "${DIR}/.env"
chmod 600 "${DIR}/.env"

SHARED_NET_RENDER="${SHARED_NET:-zapmass_default}"
render_template \
    "${TEMPLATES_DIR}/docker-compose.cliente.yml.template" \
    "${DIR}/docker-compose.yml" \
    "SLUG=${SLUG}" \
    "HOST_PORT=${PORTA}" \
    "DATA_DIR=${DATA_DIR}" \
    "SHARED_NETWORK=${SHARED_NET_RENDER}" \
    "MEM_LIMIT=${MEM_LIMIT}" \
    "CPU_LIMIT=${CPU_LIMIT}"

cat > "$(cliente_meta "$SLUG")" <<EOF
{
  "slug": "${SLUG}",
  "dominio": "${DOMINIO}",
  "host_port": ${PORTA},
  "tier": "${TIER}",
  "postgres_db": "${DB_NAME}",
  "redis_db": ${REDIS_DB},
  "criado_em": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "plano_b": true,
  "ssl": $( [ "$USAR_SSL" -eq 1 ] && echo true || echo false )
}
EOF

log "Subindo zapmass-cli-${SLUG}..."
(cd "$DIR" && docker compose up -d)
ligar_cliente_rede_compose "$SLUG"

log "Aguardando /api/health (até 90s)..."
OK=0
for i in $(seq 1 30); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORTA}/api/health" || echo 000)"
    if [ "$code" = "200" ]; then OK=1; break; fi
    sleep 3
done
if [ "$OK" -ne 1 ]; then
    err "Health check falhou. Logs: docker compose -f ${DIR}/docker-compose.yml logs --tail=80"
    exit 1
fi
ok "Container saudável."

log "Nginx → ${DOMINIO}..."
NGINX_FILE="${NGINX_AVAILABLE}/zapmass-${SLUG}"
render_template \
    "${TEMPLATES_DIR}/nginx-cliente.conf.template" \
    "${NGINX_FILE}" \
    "DOMAIN=${DOMINIO}" \
    "HOST_PORT=${PORTA}" \
    "SLUG=${SLUG}"
ln -sf "$NGINX_FILE" "${NGINX_ENABLED}/zapmass-${SLUG}"

if ! nginx -t 2>/dev/null; then
    err "nginx -t falhou."
    rm -f "${NGINX_ENABLED}/zapmass-${SLUG}" "$NGINX_FILE"
    exit 1
fi
systemctl reload nginx
ok "Virtual-host ativo."

if [ "$USAR_SSL" -eq 1 ] && command -v certbot >/dev/null 2>&1; then
    log "Certificado Let's Encrypt..."
    if certbot --nginx -d "${DOMINIO}" --non-interactive --agree-tos --redirect \
        -m "${ZAPMASS_CERTBOT_EMAIL:-admin@${DOMINIO_RAIZ}}" 2>/dev/null; then
        ok "HTTPS: https://${DOMINIO}"
    else
        warn "Certbot falhou — confirme DNS e rode: certbot --nginx -d ${DOMINIO}"
    fi
fi

bash "${SELF_DIR}/setup-backup-cron.sh" >/dev/null 2>&1 || true

echo
ok "Plano B — cliente ${C_BOLD}${SLUG}${C_END} pronto."
echo "  URL:          https://${DOMINIO}"
echo "  Porta local:  ${PORTA}"
echo "  Tier:         ${TIER} (${MEM_LIMIT} RAM, ${CPU_LIMIT} CPU)"
echo "  Postgres:     ${DB_NAME}"
echo "  Redis DB:     ${REDIS_DB}"
echo "  Backup key:   ${BACKUP_KEY}"
echo
echo "Próximos passos:"
echo "  1. MERCADOPAGO_* no ${DIR}/.env (se cobrar nesta instância)"
echo "  2. bash ${SELF_DIR}/monitor-clientes.sh"
echo "  3. bash ${SELF_DIR}/backup-cliente.sh ${SLUG}"
