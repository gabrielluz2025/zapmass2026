#!/usr/bin/env bash
# Atualiza cliente existente para templates Plano B (DB dedicada, Redis DB, limites, rede).
#
# USO:
#   sudo bash migrar-cliente-plano-b.sh <slug> [--tier pro]

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"
exigir_root

SLUG_RAW="${1:-}"
if [ -z "$SLUG_RAW" ]; then
    err "Uso: $0 <slug> [--tier starter|pro|business]"
    exit 2
fi
shift || true

TIER="starter"
while [ $# -gt 0 ]; do
    case "$1" in
        --tier|-t) TIER="${2:-starter}"; shift 2;;
        *) err "Opção desconhecida: $1"; exit 2;;
    esac
done

SLUG="$(normalizar_slug "$SLUG_RAW")"
if ! cliente_existe "$SLUG"; then
    err "Cliente '$SLUG' não existe."
    exit 1
fi

DIR="$(cliente_dir "$SLUG")"
ENV_FILE="$(cliente_env "$SLUG")"
DATA_DIR="$(cliente_data "$SLUG")"
PORTA="$(grep -E '^HOST_PORT=' "$ENV_FILE" | sed 's/^HOST_PORT=//' | head -n1)"
DOMINIO="$(grep -E '^PUBLIC_URL=' "$ENV_FILE" | sed 's#^PUBLIC_URL=https\?://##' | head -n1)"
BACKUP_KEY="$(grep -E '^BACKUP_API_KEY=' "$ENV_FILE" | sed 's/^BACKUP_API_KEY=//' | head -n1)"
BACKUP_KEY="${BACKUP_KEY:-$(gerar_chave)}"

REDIS_DB="$(grep -E '^REDIS_URL=.*/[0-9]+$' "$ENV_FILE" | sed 's#.*/##' | head -n1 || true)"
REDIS_DB="${REDIS_DB:-$(proximo_redis_db)}"

DB_NAME="$(db_name_para_slug "$SLUG")"
POSTGRES_PASSWORD="$(ler_postgres_password)"
EVOLUTION_API_KEY="$(grep -E '^EVOLUTION_API_KEY=' "$ENV_FILE" | sed 's/^EVOLUTION_API_KEY=//' | head -n1)"
EVOLUTION_API_KEY="${EVOLUTION_API_KEY:-zapmass-secure-key-2026}"
WWEBJS_URL="$(ler_wwebjs_bundle_url)"
JWT_SECRET="$(ler_jwt_secret)"
SHARED_NET="$(compose_shared_network)"
SHARED_NET_RENDER="${SHARED_NET:-zapmass_default}"

tier_recursos "$TIER"
ensure_client_database "$DB_NAME"

log "Migrando ${SLUG} → Plano B (tier ${TIER})..."

PREV_DB_URL="$(grep -E '^ZAPMASS_DATABASE_URL=' "$ENV_FILE" 2>/dev/null | sed 's/^ZAPMASS_DATABASE_URL=//' | head -n1 || true)"
PREV_MP_TOKEN="$(grep -E '^MERCADOPAGO_ACCESS_TOKEN=' "$ENV_FILE" 2>/dev/null | sed 's/^MERCADOPAGO_ACCESS_TOKEN=//' | head -n1 || true)"
PREV_MP_BACK="$(grep -E '^MERCADOPAGO_BACK_URL=' "$ENV_FILE" 2>/dev/null | sed 's/^MERCADOPAGO_BACK_URL=//' | head -n1 || true)"

cp "${ENV_FILE}" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"

render_template \
    "${TEMPLATES_DIR}/cliente.env.template" \
    "${ENV_FILE}" \
    "SLUG=${SLUG}" \
    "DOMAIN=${DOMINIO}" \
    "BACKUP_KEY=${BACKUP_KEY}" \
    "EVOLUTION_API_KEY=${EVOLUTION_API_KEY}" \
    "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}" \
    "DB_NAME=${DB_NAME}" \
    "REDIS_DB=${REDIS_DB}" \
    "TIER=${TIER}" \
    "WWEBJS_WEB_VERSION_URL=${WWEBJS_URL}" \
    "JWT_SECRET=${JWT_SECRET}"

if grep -qE '^HOST_PORT=' "${ENV_FILE}"; then
    sed -i "s/^HOST_PORT=.*/HOST_PORT=${PORTA}/" "${ENV_FILE}"
else
    printf '\nHOST_PORT=%s\n' "$PORTA" >> "${ENV_FILE}"
fi

# Cliente legado com dados em DB partilhada (ex.: demo → zapmass_db): não forçar zapmass_cli_<slug> vazia.
if [ -n "$PREV_DB_URL" ] && [[ "$PREV_DB_URL" != *"/${DB_NAME}"* ]] && [[ "$PREV_DB_URL" == *"@postgres:"* ]]; then
    warn "Mantendo ZAPMASS_DATABASE_URL legado (${PREV_DB_URL##*/}) — dados não migrados para ${DB_NAME}."
    sed -i "s|^ZAPMASS_DATABASE_URL=.*|ZAPMASS_DATABASE_URL=${PREV_DB_URL}|" "${ENV_FILE}"
fi
if [ -n "$PREV_MP_TOKEN" ]; then
    if grep -qE '^MERCADOPAGO_ACCESS_TOKEN=' "${ENV_FILE}"; then
        sed -i "s|^MERCADOPAGO_ACCESS_TOKEN=.*|MERCADOPAGO_ACCESS_TOKEN=${PREV_MP_TOKEN}|" "${ENV_FILE}"
    else
        printf 'MERCADOPAGO_ACCESS_TOKEN=%s\n' "$PREV_MP_TOKEN" >> "${ENV_FILE}"
    fi
fi
if [ -n "$PREV_MP_BACK" ]; then
    if grep -qE '^MERCADOPAGO_BACK_URL=' "${ENV_FILE}"; then
        sed -i "s|^MERCADOPAGO_BACK_URL=.*|MERCADOPAGO_BACK_URL=${PREV_MP_BACK}|" "${ENV_FILE}"
    else
        printf 'MERCADOPAGO_BACK_URL=%s\n' "$PREV_MP_BACK" >> "${ENV_FILE}"
    fi
fi
sincronizar_jwt_cliente "$ENV_FILE"
chmod 600 "${ENV_FILE}"

render_template \
    "${TEMPLATES_DIR}/docker-compose.cliente.yml.template" \
    "${DIR}/docker-compose.yml" \
    "SLUG=${SLUG}" \
    "HOST_PORT=${PORTA}" \
    "DATA_DIR=${DATA_DIR}" \
    "SHARED_NETWORK=${SHARED_NET_RENDER}" \
    "MEM_LIMIT=${MEM_LIMIT}" \
    "CPU_LIMIT=${CPU_LIMIT}"

# Atualizar meta
if [ -f "$(cliente_meta "$SLUG")" ]; then
    python3 - <<PY 2>/dev/null || true
import json
p = "$(cliente_meta "$SLUG")"
with open(p) as f: m = json.load(f)
m.update({"plano_b": True, "tier": "${TIER}", "postgres_db": "${DB_NAME}", "redis_db": int("${REDIS_DB}")})
with open(p, "w") as f: json.dump(m, f, indent=2)
PY
fi

bash "${SELF_DIR}/setup-nginx-rate-limit.sh" || true

NGINX_FILE="${NGINX_AVAILABLE}/zapmass-${SLUG}"
if [ -f "$NGINX_FILE" ]; then
    case "$DOMINIO" in
        zap-mass.com|www.zap-mass.com)
            warn "Domínio ${DOMINIO} conflita com a instância principal — considere demo.zap-mass.com (ou outro subdomínio)."
            ;;
    esac
    render_template \
        "${TEMPLATES_DIR}/nginx-cliente.conf.template" \
        "$NGINX_FILE" \
        "DOMAIN=${DOMINIO}" \
        "HOST_PORT=${PORTA}" \
        "SLUG=${SLUG}"
    nginx -t && systemctl reload nginx
fi

recriar_cliente_compose "$DIR" "$SLUG"
bash "${SELF_DIR}/setup-backup-cron.sh" || true

ok "Cliente ${SLUG} migrado para Plano B."
bash "${SELF_DIR}/monitor-clientes.sh" | head -20
