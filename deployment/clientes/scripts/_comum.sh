#!/usr/bin/env bash
# Funcoes e constantes partilhadas por todos os scripts de gestao de clientes.
# Nao executar diretamente.

set -euo pipefail

# Raiz do projeto ZapMass na VPS.
ZAPMASS_ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
CLIENTES_DIR="${ZAPMASS_ROOT}/clientes"
TEMPLATES_DIR="${ZAPMASS_ROOT}/deployment/clientes"
NGINX_AVAILABLE="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"

# Faixa de portas reservada para instancias de cliente no host.
PORT_MIN=3100
PORT_MAX=3999

# Cores para mensagens no terminal (desliga se nao for TTY).
if [ -t 1 ]; then
    C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
    C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'; C_END=$'\033[0m'
else
    C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_END=""
fi

log()  { echo "${C_BLUE}[zapmass]${C_END} $*"; }
ok()   { echo "${C_GREEN}[ok]${C_END} $*"; }
warn() { echo "${C_YELLOW}[aviso]${C_END} $*" >&2; }
err()  { echo "${C_RED}[erro]${C_END} $*" >&2; }

exigir_root() {
    if [ "$(id -u)" -ne 0 ]; then
        err "Este script precisa ser executado como root (use sudo)."
        exit 1
    fi
}

# Normaliza o nome do cliente: minusculas, so letras/digitos/-.
# Rejeita nomes vazios ou com caracteres estranhos.
normalizar_slug() {
    local raw="${1:-}"
    local slug
    slug="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g; s/--*/-/g; s/^-//; s/-$//')"
    if [ -z "$slug" ]; then
        err "Nome de cliente invalido: '$raw'"
        return 1
    fi
    if [ "${#slug}" -lt 2 ] || [ "${#slug}" -gt 40 ]; then
        err "Slug deve ter entre 2 e 40 caracteres (obtido: '$slug')."
        return 1
    fi
    printf '%s' "$slug"
}

cliente_dir() { printf '%s/%s' "$CLIENTES_DIR" "$1"; }
cliente_env() { printf '%s/%s/.env' "$CLIENTES_DIR" "$1"; }
cliente_compose() { printf '%s/%s/docker-compose.yml' "$CLIENTES_DIR" "$1"; }
cliente_data() { printf '%s/%s/data' "$CLIENTES_DIR" "$1"; }
cliente_meta() { printf '%s/%s/cliente.json' "$CLIENTES_DIR" "$1"; }

cliente_existe() {
    local slug="$1"
    [ -d "$(cliente_dir "$slug")" ]
}

# Descobre a proxima porta livre na faixa reservada, escolhendo a primeira
# que nao esteja registada em nenhum .env de cliente e nao esteja em uso.
proxima_porta_livre() {
    local porta usada
    local usadas_file
    usadas_file="$(mktemp)"
    trap 'rm -f "$usadas_file"' RETURN

    if [ -d "$CLIENTES_DIR" ]; then
        # Grep apanhao mesmo que o .env nao exista em algum slug.
        grep -hE '^HOST_PORT=' "$CLIENTES_DIR"/*/.env 2>/dev/null \
          | sed 's/^HOST_PORT=//' >> "$usadas_file" || true
    fi

    for porta in $(seq "$PORT_MIN" "$PORT_MAX"); do
        if grep -qx "$porta" "$usadas_file"; then continue; fi
        # ss ou netstat: se nenhum disponivel, assume livre.
        if command -v ss >/dev/null 2>&1; then
            if ss -ltn "sport = :$porta" 2>/dev/null | grep -q ":$porta"; then continue; fi
        fi
        printf '%s' "$porta"
        return 0
    done

    err "Nenhuma porta livre entre $PORT_MIN e $PORT_MAX."
    return 1
}

# Substitui {{CHAVE}} -> valor no ficheiro de template indicado, gravando em $2.
# Uso: render_template origem destino KEY1=val1 KEY2=val2 ...
render_template() {
    local origem="$1"; local destino="$2"; shift 2
    local tmp; tmp="$(mktemp)"
    cp "$origem" "$tmp"
    local par chave valor
    for par in "$@"; do
        chave="${par%%=*}"
        valor="${par#*=}"
        # Usa um separador improvavel para evitar conflitos com / no valor.
        sed -i "s|{{${chave}}}|${valor}|g" "$tmp"
    done
    mv "$tmp" "$destino"
}

gerar_chave() { openssl rand -hex 24 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 32 | head -n1; }

# --- Plano B: rede Compose, Postgres, Redis, tiers ---

ler_postgres_password() {
    local f="${ZAPMASS_ROOT}/.env"
    local pass=""
    if [ -f "$f" ]; then
        pass="$(grep -E '^[[:space:]]*(export[[:space:]]+)?POSTGRES_PASSWORD=' "$f" 2>/dev/null | tail -1 \
            | sed -E 's/^[[:space:]]*(export[[:space:]]+)?POSTGRES_PASSWORD=//' | tr -d '\r"'\'')"
    fi
    printf '%s' "${pass:-evolution-secure-pass-2026}"
}

postgres_container_name() {
    docker ps --format '{{.Names}}' 2>/dev/null | grep -E 'postgres' | head -1 || true
}

compose_shared_network() {
    local net
    net="$(docker network ls --format '{{.Name}}' 2>/dev/null | grep -E '^zapmass_default$|^zapmass_zapmass_default$' | head -1 || true)"
    if [ -n "$net" ]; then
        printf '%s' "$net"
        return 0
    fi
    net="$(swarm_overlay_network)"
    printf '%s' "$net"
}

db_name_para_slug() {
    local slug="$1"
    local safe
    safe="$(printf '%s' "$slug" | tr '-' '_')"
    printf 'zapmass_cli_%s' "$safe"
}

# Redis DB 2–15 para clientes (0 stack, 1 Evolution).
proximo_redis_db() {
    local usadas_file db
    usadas_file="$(mktemp)"
    trap 'rm -f "$usadas_file"' RETURN
    echo "1" >> "$usadas_file"
    if [ -d "$CLIENTES_DIR" ]; then
        grep -hE '^REDIS_URL=.*redis://' "$CLIENTES_DIR"/*/.env 2>/dev/null \
            | sed -n 's#.*/\([0-9]\+\)$#\1#p' >> "$usadas_file" || true
    fi
    for db in $(seq 2 15); do
        if ! grep -qx "$db" "$usadas_file"; then
            printf '%s' "$db"
            return 0
        fi
    done
    err "Sem índice Redis livre (2–15). Limite de clientes na VPS."
    return 1
}

ensure_client_database() {
    local db_name="$1"
    local pg pass
    pg="$(postgres_container_name)"
    if [ -z "$pg" ]; then
        warn "Container Postgres não encontrado — DB ${db_name} será criada no 1.º arranque do app."
        return 0
    fi
    pass="$(ler_postgres_password)"
    local exists
    exists="$(docker exec "$pg" psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${db_name}'" 2>/dev/null || true)"
    if [ "$exists" = "1" ]; then
        log "Base Postgres ${db_name} já existe."
        return 0
    fi
    log "A criar base Postgres ${db_name}..."
    docker exec "$pg" psql -U postgres -c "CREATE DATABASE ${db_name};" >/dev/null
    ok "Base ${db_name} criada."
}

tier_recursos() {
    local tier="${1:-starter}"
    case "$tier" in
        business)
            MEM_LIMIT="3072M"
            CPU_LIMIT="2.0"
            ;;
        pro)
            MEM_LIMIT="2048M"
            CPU_LIMIT="1.5"
            ;;
        starter|*)
            MEM_LIMIT="1536M"
            CPU_LIMIT="1.0"
            ;;
    esac
    export MEM_LIMIT CPU_LIMIT
}

ler_wwebjs_bundle_url() {
    local bundle="${TEMPLATES_DIR}/../wwebjs-default-bundle.env"
    local url=""
    if [ -f "$bundle" ]; then
        # shellcheck disable=SC1090
        . "$bundle" 2>/dev/null || true
        url="${WWEBJS_WEB_VERSION_URL:-}"
    fi
    if [ -z "$url" ]; then
        url="https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1034300341-alpha.html"
    fi
    printf '%s' "$url"
}

ligar_cliente_rede_compose() {
    local slug="$1"
    local net
    net="$(compose_shared_network)"
    if [ -z "$net" ]; then
        warn "Rede Compose partilhada não encontrada — cliente ${slug} sem Redis/Postgres internos."
        return 0
    fi
    if docker network connect "$net" "zapmass-cli-${slug}" 2>/dev/null; then
        log "Cliente ${slug} ligado à rede ${net}."
    fi
}

# Remove contentores duplicados/orfaos (ex.: 7679e29ff1bc_zapmass-cli-demo) antes do compose up.
limpar_containers_cliente() {
    local slug="$1"
    local needle="zapmass-cli-${slug}"
    local id name removed=0

    while IFS= read -r id; do
        [ -z "$id" ] && continue
        if docker rm -f "$id" >/dev/null 2>&1; then
            removed=$((removed + 1))
        fi
    done < <(docker ps -aq --filter "name=${needle}" 2>/dev/null || true)

    while IFS= read -r name; do
        [ -z "$name" ] && continue
        case "$name" in
            *"${needle}"*)
                if docker rm -f "$name" >/dev/null 2>&1; then
                    removed=$((removed + 1))
                    log "Removido contentor antigo: ${name}"
                fi
                ;;
        esac
    done < <(docker ps -a --format '{{.Names}}' 2>/dev/null || true)

    return 0
}

# Recria o stack de um cliente sem conflito de container_name.
swarm_overlay_network() {
    docker network ls --format '{{.Name}}' | grep -E '^zapmass_zapmass_internal$|^zapmass_internal$' | head -1 || true
}

ligar_cliente_rede_swarm() {
    local slug="$1"
    local net
    net="$(swarm_overlay_network)"
    if [ -z "$net" ]; then
        warn "Rede overlay Swarm nao encontrada — cliente ${slug} sem Redis partilhado."
        return 0
    fi
    if docker network connect "$net" "zapmass-cli-${slug}" 2>/dev/null; then
        log "Cliente ${slug} ligado a rede ${net} (Redis/Evolution internos)."
    fi
}

recriar_cliente_compose() {
    local dir="$1"
    local slug="$2"
    limpar_containers_cliente "$slug"
    (cd "$dir" && docker compose up -d --force-recreate --remove-orphans)
    ligar_cliente_rede_compose "$slug"
    ligar_cliente_rede_swarm "$slug"
}
