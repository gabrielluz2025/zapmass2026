#!/usr/bin/env bash
# Prepara cliente legado (pasta + container, sem .env/compose Plano B) e migra.
#
# Caso típico: zapmass-cli-demo a correr há semanas, data/ montado, mas faltam
# clientes/<slug>/.env e docker-compose.yml — migrar-todos ignora estes slugs.
#
# USO:
#   sudo bash bootstrap-cliente-legado.sh demo
#   sudo bash bootstrap-cliente-legado.sh demo --dominio zap-mass.com --port 3100 --tier starter
#
# Depois (ou automaticamente): migrar-cliente-plano-b.sh

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"
exigir_root

SLUG_RAW="${1:-}"
if [ -z "$SLUG_RAW" ]; then
    err "Uso: $0 <slug> [--dominio dominio.com] [--port N] [--tier starter|pro|business] [--sem-migrar]"
    exit 2
fi
shift || true

DOMINIO=""
PORTA=""
TIER="starter"
SEM_MIGRAR=0

while [ $# -gt 0 ]; do
    case "$1" in
        --dominio|-d) DOMINIO="${2:-}"; shift 2;;
        --port|-p) PORTA="${2:-}"; shift 2;;
        --tier|-t) TIER="${2:-starter}"; shift 2;;
        --sem-migrar) SEM_MIGRAR=1; shift;;
        *) err "Opção desconhecida: $1"; exit 2;;
    esac
done

SLUG="$(normalizar_slug "$SLUG_RAW")"
if ! cliente_existe "$SLUG"; then
    err "Pasta $(cliente_dir "$SLUG") não existe."
    exit 1
fi

CONTAINER="zapmass-cli-${SLUG}"
ENV_FILE="$(cliente_env "$SLUG")"
COMPOSE_FILE="$(cliente_compose "$SLUG")"

ler_env_container() {
    local key="$1"
    docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
        | grep -E "^${key}=" | tail -1 | sed "s/^${key}=//" | tr -d '\r' || true
}

if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
    log "Container ${CONTAINER} encontrado."
else
    warn "Container ${CONTAINER} não encontrado — valores só via flags ou Nginx."
fi

if [ -z "$PORTA" ]; then
    PORTA="$(ler_env_container HOST_PORT)"
    PORTA="${PORTA:-}"
fi
if [ -z "$PORTA" ] && docker ps --filter "name=^${CONTAINER}$" --format '{{.Ports}}' 2>/dev/null | grep -q .; then
    PORTA="$(docker ps --filter "name=^${CONTAINER}$" --format '{{.Ports}}' \
        | sed -n 's/.*127\.0\.0\.1:\([0-9]\+\)->3001.*/\1/p; s/.*0\.0\.0\.0:\([0-9]\+\)->3001.*/\1/p' \
        | head -n1)"
fi
if [ -z "$PORTA" ]; then
    PORTA="$(proxima_porta_livre)"
    warn "Porta não detectada — a usar ${PORTA}."
fi

if [ -z "$DOMINIO" ]; then
    pub="$(ler_env_container PUBLIC_URL)"
    if [ -n "$pub" ]; then
        DOMINIO="$(printf '%s' "$pub" | sed -E 's#^https?://##; s#/$##')"
    fi
fi
if [ -z "$DOMINIO" ] && [ -f "${NGINX_AVAILABLE}/zapmass-${SLUG}" ]; then
    DOMINIO="$(grep -E 'server_name ' "${NGINX_AVAILABLE}/zapmass-${SLUG}" 2>/dev/null \
        | head -n1 | sed -E 's/.*server_name[[:space:]]+([^;[:space:]]+).*/\1/' || true)"
fi
if [ -z "$DOMINIO" ]; then
    DOMINIO="${SLUG}.${ZAPMASS_DOMINIO_RAIZ:-zap-mass.com}"
    warn "Domínio não detectado — a usar ${DOMINIO} (confirme DNS/Nginx)."
fi

if [ -f "$ENV_FILE" ] && [ -f "$COMPOSE_FILE" ]; then
    log "Já existem .env e docker-compose.yml — a migrar apenas."
    bash "${SELF_DIR}/migrar-cliente-plano-b.sh" "$SLUG" --tier "$TIER"
    exit 0
fi

log "Bootstrap legado: ${SLUG} · ${DOMINIO} · porta ${PORTA} · tier ${TIER}"

BACKUP_KEY="$(ler_env_container BACKUP_API_KEY)"
BACKUP_KEY="${BACKUP_KEY:-$(gerar_chave)}"
REDIS_DB="$(ler_env_container REDIS_URL | sed -n 's#.*/\([0-9]\+\)$#\1#p')"
REDIS_DB="${REDIS_DB:-$(proximo_redis_db)}"
DB_NAME="$(db_name_para_slug "$SLUG")"
POSTGRES_PASSWORD="$(ler_postgres_password)"
EVOLUTION_API_KEY="$(ler_env_container EVOLUTION_API_KEY)"
EVOLUTION_API_KEY="${EVOLUTION_API_KEY:-zapmass-secure-key-2026}"
WWEBJS_URL="$(ler_wwebjs_bundle_url)"
MP_TOKEN="$(ler_env_container MERCADOPAGO_ACCESS_TOKEN)"
MP_BACK="$(ler_env_container MERCADOPAGO_BACK_URL)"
OLD_DB="$(ler_env_container ZAPMASS_DATABASE_URL)"

if [ -n "$OLD_DB" ] && [[ "$OLD_DB" != *"${DB_NAME}"* ]]; then
    warn "Container usa DB diferente de ${DB_NAME}:"
    warn "  ${OLD_DB}"
    warn "Migrar Plano B apontará para Postgres dedicado ${DB_NAME} (dados antigos podem ficar na DB anterior)."
fi

if [ ! -f "$ENV_FILE" ]; then
    log "A criar ${ENV_FILE}..."
    render_template \
        "${TEMPLATES_DIR}/cliente.env.template" \
        "$ENV_FILE" \
        "SLUG=${SLUG}" \
        "DOMAIN=${DOMINIO}" \
        "BACKUP_KEY=${BACKUP_KEY}" \
        "EVOLUTION_API_KEY=${EVOLUTION_API_KEY}" \
        "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}" \
        "DB_NAME=${DB_NAME}" \
        "REDIS_DB=${REDIS_DB}" \
        "TIER=${TIER}" \
        "WWEBJS_WEB_VERSION_URL=${WWEBJS_URL}"
    printf '\nHOST_PORT=%s\n' "$PORTA" >> "$ENV_FILE"
    if [ -n "$MP_TOKEN" ]; then
        printf 'MERCADOPAGO_ACCESS_TOKEN=%s\n' "$MP_TOKEN" >> "$ENV_FILE"
    fi
    if [ -n "$MP_BACK" ]; then
        printf 'MERCADOPAGO_BACK_URL=%s\n' "$MP_BACK" >> "$ENV_FILE"
    elif [ -n "$MP_TOKEN" ]; then
        printf 'MERCADOPAGO_BACK_URL=https://%s\n' "$DOMINIO" >> "$ENV_FILE"
    fi
    chmod 600 "$ENV_FILE"
    ok ".env criado."
else
    log ".env já existe — mantido."
fi

if [ "$SEM_MIGRAR" -eq 1 ]; then
    ok "Bootstrap concluído (sem migrar). Rode: migrar-cliente-plano-b.sh ${SLUG}"
    exit 0
fi

bash "${SELF_DIR}/migrar-cliente-plano-b.sh" "$SLUG" --tier "$TIER"
