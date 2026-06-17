#!/usr/bin/env bash
# Corrige "o sistema nem abre, fica só carregando":
# - Desliga WA_FULL_INBOX_SYNC na stack principal (evita sync duplo pesado)
# - Aponta zap-mass.com (Nginx principal) para o container Plano B com os dados
# - Remove vhost duplicado do cliente (conflito server_name)
# - Para a instância main duplicada (postgres/redis/evolution continuam)
#
# USO (na VPS):
#   sudo bash deployment/clientes/scripts/corrigir-site-so-carregando.sh demo
#
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"
exigir_root

SLUG="$(normalizar_slug "${1:-demo}")"
if ! cliente_existe "$SLUG"; then
    err "Cliente '${SLUG}' não encontrado em ${CLIENTES_DIR}."
    exit 1
fi

ENV_FILE="$(cliente_env "$SLUG")"
COMPOSE_FILE="$(cliente_compose "$SLUG")"
if [ ! -f "$ENV_FILE" ] || [ ! -f "$COMPOSE_FILE" ]; then
    err "Faltam .env ou docker-compose.yml — rode bootstrap/migrar Plano B primeiro."
    exit 1
fi

PORT="$(grep -E '^HOST_PORT=' "$ENV_FILE" | tail -1 | sed 's/^HOST_PORT=//' | tr -d $'\r"\'')"
PORT="${PORT:-3100}"
DOMINIO="$(grep -E '^PUBLIC_URL=' "$ENV_FILE" | tail -1 | sed -E 's#^PUBLIC_URL=https?://##; s#/$##' | tr -d $'\r"\'')"
DOMINIO="${DOMINIO:-zap-mass.com}"

definir_env() {
    local f="$1" key="$2" val="$3"
    if grep -qE "^[[:space:]]*${key}=" "$f" 2>/dev/null; then
        sed -i -E "s|^[[:space:]]*${key}=.*|${key}=${val}|" "$f"
    else
        printf '\n%s=%s\n' "$key" "$val" >>"$f"
    fi
}

log "=== Corrigir site só carregando — cliente ${SLUG} · porta ${PORT} · ${DOMINIO} ==="

# 1) Inbox sync leve (principal + cliente)
MAIN_ENV="${ZAPMASS_ROOT}/.env"
if [ -f "$MAIN_ENV" ]; then
    definir_env "$MAIN_ENV" WA_FULL_INBOX_SYNC 0
    ok "WA_FULL_INBOX_SYNC=0 em ${MAIN_ENV}"
fi
definir_env "$ENV_FILE" WA_FULL_INBOX_SYNC 0
ok "WA_FULL_INBOX_SYNC=0 em ${ENV_FILE}"

# 2) Para instância main duplicada (mesma DB + Evolution = event loop bloqueado)
if [ -f "${ZAPMASS_ROOT}/docker-compose.yml" ]; then
    log "A parar serviço zapmass da stack principal (mantém Postgres/Redis/Evolution)..."
    (cd "$ZAPMASS_ROOT" && docker compose stop zapmass 2>/dev/null) || true
    docker stop zapmass-zapmass-1 2>/dev/null || true
    ok "Instância main parada — tráfego só via container ${SLUG}."
fi

# 3) Nginx principal → porta do cliente
NGINX_MAIN="${NGINX_AVAILABLE}/zapmass"
if [ ! -f "$NGINX_MAIN" ]; then
    NGINX_MAIN="${NGINX_AVAILABLE}/zap-mass"
fi
if [ -f "$NGINX_MAIN" ]; then
    sed -i -E "s|proxy_pass http://127\\.0\\.0\\.1:[0-9]+;|proxy_pass http://127.0.0.1:${PORT};|g" "$NGINX_MAIN"
    ok "Nginx ${NGINX_MAIN} → 127.0.0.1:${PORT}"
else
    warn "Ficheiro Nginx principal não encontrado — ajuste manual proxy_pass para :${PORT}"
fi

# 4) Remove vhost duplicado do cliente (server_name conflitante)
for f in "${NGINX_ENABLED}/zapmass-${SLUG}" "${NGINX_ENABLED}/zapmass_${SLUG}"; do
    if [ -e "$f" ]; then
        rm -f "$f"
        warn "Removido symlink duplicado: $f"
    fi
done

if nginx -t 2>/dev/null; then
    systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || true
    ok "Nginx recarregado."
else
    err "nginx -t falhou — corrija manualmente antes de reload."
    exit 1
fi

# 5) Recria container do cliente
log "A recriar zapmass-cli-${SLUG}..."
CLIENT_DIR="$(cliente_dir "$SLUG")"
recriar_cliente_compose "$CLIENT_DIR" "$SLUG"

# 6) Health local
log "Aguardando /api/health em 127.0.0.1:${PORT} (até 120s)..."
ok_health=0
for i in $(seq 1 24); do
    code="$(curl -sS -o /tmp/zm-health.json -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null || echo 000)"
    if [ "$code" = "200" ]; then
        ok_health=1
        break
    fi
    sleep 5
done

if [ "$ok_health" = "1" ]; then
    ver="$(grep -o '"version":"[^"]*"' /tmp/zm-health.json 2>/dev/null | head -1 || true)"
    ok "API respondeu HTTP 200 ${ver:-}"
else
    warn "Health ainda não respondeu — veja: docker logs zapmass-cli-${SLUG} --tail 80"
fi

echo ""
echo "Próximo passo no browser: Ctrl+Shift+R em https://${DOMINIO}/"
echo "Se ainda falhar: docker logs zapmass-cli-${SLUG} --tail 100"
