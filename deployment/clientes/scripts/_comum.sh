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

# JWT da stack principal — clientes Plano B precisam do MESMO segredo para login.
ler_jwt_secret() {
    local f="${ZAPMASS_ROOT}/.env"
    local secret=""
    if [ -f "$f" ]; then
        secret="$(grep -E '^[[:space:]]*(export[[:space:]]+)?ZAPMASS_JWT_SECRET=' "$f" 2>/dev/null | tail -1 \
            | sed -E 's/^[[:space:]]*(export[[:space:]]+)?ZAPMASS_JWT_SECRET=//' \
            | tr -d $'\r"\'')"
    fi
    if [ -z "$secret" ] || [ "${#secret}" -lt 16 ]; then
        secret="$(openssl rand -hex 32 2>/dev/null || gerar_chave)"
        warn "ZAPMASS_JWT_SECRET ausente/curto em ${f} — gerado novo (grave no .env principal)."
        if [ -f "$f" ]; then
            if grep -qE '^[[:space:]]*(export[[:space:]]+)?ZAPMASS_JWT_SECRET=' "$f" 2>/dev/null; then
                sed -i -E "s|^[[:space:]]*(export[[:space:]]+)?ZAPMASS_JWT_SECRET=.*|ZAPMASS_JWT_SECRET=${secret}|" "$f"
            else
                printf '\nZAPMASS_JWT_SECRET=%s\n' "$secret" >>"$f"
            fi
        fi
    fi
    printf '%s' "$secret"
}

sincronizar_jwt_cliente() {
    local env_file="$1"
    local secret
    secret="$(ler_jwt_secret)"
    if [ ! -f "$env_file" ]; then
        warn "Sem .env do cliente para sincronizar JWT: ${env_file}"
        return 1
    fi
    if grep -qE '^[[:space:]]*ZAPMASS_JWT_SECRET=' "$env_file" 2>/dev/null; then
        sed -i -E "s|^[[:space:]]*ZAPMASS_JWT_SECRET=.*|ZAPMASS_JWT_SECRET=${secret}|" "$env_file"
    else
        printf '\nZAPMASS_JWT_SECRET=%s\n' "$secret" >>"$env_file"
    fi
    ok "ZAPMASS_JWT_SECRET sincronizado em ${env_file}"
}

# Origem dos uploads da stack principal (bind mount ou volume Docker zapmass-data).
_uploads_legado_dir() {
    local d mp vol
    for d in "${ZAPMASS_ROOT}/data/public/uploads"; do
        if [ -d "$d" ] && [ -n "$(ls -A "$d" 2>/dev/null)" ]; then
            printf '%s' "$d"
            return 0
        fi
    done
    for vol in zapmass_zapmass-data zapmass-data; do
        mp="$(docker volume inspect "$vol" --format '{{.Mountpoint}}' 2>/dev/null || true)"
        d="${mp}/public/uploads"
        if [ -n "$mp" ] && [ -d "$d" ] && [ -n "$(ls -A "$d" 2>/dev/null)" ]; then
            printf '%s' "$d"
            return 0
        fi
    done
    return 1
}

# Fotos de perfil /uploads da stack principal → volume do cliente Plano B.
sincronizar_uploads_legado() {
    local slug="$1"
    local legacy target n
    target="$(cliente_data "$slug")/public/uploads"
    legacy="$(_uploads_legado_dir || true)"
    if [ -z "$legacy" ]; then
        log "Sem uploads legados (nem ${ZAPMASS_ROOT}/data nem volume zapmass-data) — reenvie a foto em Configurações se necessário."
        return 0
    fi
    mkdir -p "$target"
    log "A copiar uploads de ${legacy} → ${target} ..."
    if command -v rsync >/dev/null 2>&1; then
        rsync -a "$legacy/" "$target/" 2>/dev/null || true
    else
        cp -a "$legacy/." "$target/" 2>/dev/null || true
    fi
    n="$(find "$target" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')"
    ok "Uploads legados sincronizados (${n} ficheiros) → ${target}"
}

# --- Plano B: rede Compose, Postgres, Redis, tiers ---

ler_postgres_password() {
    local f="${ZAPMASS_ROOT}/.env"
    local pass=""
    if [ -f "$f" ]; then
        pass="$(grep -E '^[[:space:]]*(export[[:space:]]+)?POSTGRES_PASSWORD=' "$f" 2>/dev/null | tail -1 \
            | sed -E 's/^[[:space:]]*(export[[:space:]]+)?POSTGRES_PASSWORD=//' \
            | tr -d $'\r"\'')"
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

# Rebuild da imagem usada pelos containers Plano B (zapmass-zapmass:latest).
build_imagem_plano_b() {
    local git_ref
    git_ref="$(cd "$ZAPMASS_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo plano-b)"
    if [ "${ZAPMASS_SKIP_DOCKER_BUILD:-0}" = "1" ]; then
        if docker image inspect zapmass-zapmass:latest >/dev/null 2>&1 \
            || docker image inspect zapmass:latest >/dev/null 2>&1; then
            warn "ZAPMASS_SKIP_DOCKER_BUILD=1 — reutiliza imagem existente."
            docker tag zapmass:latest zapmass-zapmass:latest 2>/dev/null || true
            return 0
        fi
        err "ZAPMASS_SKIP_DOCKER_BUILD=1 mas não há imagem zapmass:latest."
        return 1
    fi
    log "Docker build (Plano B) — commit ${git_ref}..."
    export DOCKER_BUILDKIT=1
    if ! (cd "$ZAPMASS_ROOT" && docker build -t zapmass:latest \
        --build-arg CACHEBUST="${git_ref}" \
        --build-arg VITE_GIT_REF="${git_ref}" \
        .); then
        err "docker build falhou — tente BUILDKIT ou mais RAM; ou ZAPMASS_SKIP_DOCKER_BUILD=1 se a imagem já estiver OK."
        return 1
    fi
    docker tag zapmass:latest zapmass-zapmass:latest
    ok "Imagem zapmass-zapmass:latest atualizada (${git_ref})."
}

# Aguarda /api/health local (WhatsApp/Chromium demoram no arranque pós-recreate).
aguardar_health_cliente() {
    local slug="$1"
    local port="$2"
    local max_sec="${3:-180}"
    local container="zapmass-cli-${slug}"
    local waited=0
    local code hstatus

    log "Aguardando /api/health em 127.0.0.1:${port} (até ${max_sec}s)..."
    while [ "$waited" -lt "$max_sec" ]; do
        code="$(curl -sS -o /tmp/zm-health.json -w '%{http_code}' --max-time 5 "http://127.0.0.1:${port}/api/health" 2>/dev/null || echo 000)"
        if [ "$code" = "200" ]; then
            local ver
            ver="$(grep -o '"version":"[^"]*"' /tmp/zm-health.json 2>/dev/null | head -1 || true)"
            ok "API local respondeu HTTP 200 em ~${waited}s ${ver:-}"
            return 0
        fi

        hstatus="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || echo missing)"
        if [ "$hstatus" = "unhealthy" ]; then
            warn "Container ${container} unhealthy — últimas linhas do log:"
            docker logs "$container" --tail 25 2>&1 | tail -25 || true
        fi

        sleep 5
        waited=$((waited + 5))
    done

    err "Health local não respondeu em ${max_sec}s (HTTP ${code:-000}, docker health=${hstatus:-?})."
    docker logs "$container" --tail 80 2>&1 | tail -80 || true
    return 1
}

recriar_cliente_compose() {
    local dir="$1"
    local slug="$2"
    limpar_containers_cliente "$slug"
    (cd "$dir" && docker compose up -d --force-recreate --remove-orphans)
    ligar_cliente_rede_compose "$slug"
    ligar_cliente_rede_swarm "$slug"
}

# Resolve slug/porta/dominio do cliente que serve o site publico (ex.: zap-mass.com).
resolver_cliente_producao() {
    local pub="${PUBLIC_APP_URL:-https://zap-mass.com}"
    pub="${pub#https://}"
    pub="${pub#http://}"
    pub="${pub%%/*}"
    pub="${pub#www.}"

    if [ -d "$CLIENTES_DIR" ]; then
        local dir slug env_file dom port
        for dir in "${CLIENTES_DIR}"/*/; do
            [ -d "$dir" ] || continue
            slug="$(basename "$dir")"
            [[ "$slug" == *removido* ]] && continue
            env_file="$(cliente_env "$slug")"
            [ -f "$env_file" ] || continue
            dom="$(grep -E '^PUBLIC_URL=' "$env_file" 2>/dev/null | tail -1 \
                | sed -E 's#^PUBLIC_URL=https?://##; s#/$##; s#^www\.##' | tr -d $'\r"\'')"
            port="$(grep -E '^HOST_PORT=' "$env_file" 2>/dev/null | tail -1 | sed 's/^HOST_PORT=//' | tr -d $'\r"\'')"
            [ -n "$port" ] || port="3100"
            if [ "$dom" = "$pub" ] || { [ "$pub" = "zap-mass.com" ] && [ "$slug" = "demo" ]; }; then
                printf '%s %s %s' "$slug" "$port" "${dom:-$pub}"
                return 0
            fi
        done
    fi

    printf '%s %s %s' "demo" "3100" "${pub:-zap-mass.com}"
}

# Aguarda health local com versao esperada (commit curto ou SHA).
aguardar_health_cliente_versao() {
    local slug="$1"
    local port="$2"
    local expected="${3:-}"
    local max_sec="${4:-180}"
    local expected_short="${expected:0:7}"
    local waited=0 code ver

    log "Aguardando versao ${expected:-?} em 127.0.0.1:${port} (${slug}, ate ${max_sec}s)..."
    while [ "$waited" -lt "$max_sec" ]; do
        code="$(curl -sS -o /tmp/zm-health.json -w '%{http_code}' --max-time 5 "http://127.0.0.1:${port}/api/health" 2>/dev/null || echo 000)"
        if [ "$code" = "200" ]; then
            ver="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' /tmp/zm-health.json 2>/dev/null | head -1 || true)"
            if [ -z "$expected" ] \
                || [ "$ver" = "$expected" ] \
                || [ "$ver" = "$expected_short" ] \
                || [ "${ver:0:7}" = "$expected_short" ]; then
                ok "Cliente ${slug} OK (version=${ver:-?})"
                return 0
            fi
            warn "Cliente ${slug} HTTP 200 mas version=${ver:-?} != ${expected}"
        fi
        sleep 5
        waited=$((waited + 5))
    done
    err "Cliente ${slug} nao ficou na versao ${expected} em ${max_sec}s."
    docker logs "zapmass-cli-${slug}" --tail 60 2>&1 | tail -60 || true
    return 1
}
