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
    ligar_cliente_rede_swarm "$slug"
}
