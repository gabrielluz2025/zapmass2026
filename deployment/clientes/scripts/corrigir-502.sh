#!/usr/bin/env bash
# Recupera HTTP 502 (Nginx sem API no Plano B).
# Causas comuns: container parado/crash, imagem desatualizada, hot-patch .ts inconsistente.
#
# USO (na VPS):
#   sudo bash deployment/clientes/scripts/corrigir-502.sh demo
#   sudo -E ZAPMASS_SKIP_DOCKER_BUILD=1 bash ...   # só recria container (build já feito)
#   bash ... demo --skip-build                     # equivalente ao skip acima
#
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"
exigir_root

SLUG="$(normalizar_slug "${1:-demo}")"
if [ "${2:-}" = "--skip-build" ]; then
    export ZAPMASS_SKIP_DOCKER_BUILD=1
fi
if ! cliente_existe "$SLUG"; then
    err "Cliente '${SLUG}' não encontrado em ${CLIENTES_DIR}."
    exit 1
fi

ENV_FILE="$(cliente_env "$SLUG")"
PORT="$(grep -E '^HOST_PORT=' "$ENV_FILE" | tail -1 | sed 's/^HOST_PORT=//' | tr -d $'\r"\'')"
PORT="${PORT:-3100}"
CONTAINER="zapmass-cli-${SLUG}"
DOMINIO="$(grep -E '^PUBLIC_URL=' "$ENV_FILE" | tail -1 | sed -E 's#^PUBLIC_URL=https?://##; s#/$##' | tr -d $'\r"\'')"
DOMINIO="${DOMINIO:-zap-mass.com}"

log "=== Corrigir HTTP 502 — cliente ${SLUG} · porta ${PORT} ==="

# 1) Código mais recente (sem hot-patch manual)
if [ -d "${ZAPMASS_ROOT}/.git" ]; then
    log "git pull origin main..."
    (cd "$ZAPMASS_ROOT" && git fetch --all --prune && git checkout -f main 2>/dev/null || true)
    (cd "$ZAPMASS_ROOT" && git pull --ff-only origin main 2>/dev/null || git checkout -f origin/main)
    ok "Commit $(cd "$ZAPMASS_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?')"
fi

# 2) Diagnóstico rápido
log "Estado do container ${CONTAINER}:"
docker ps -a --filter "name=^/${CONTAINER}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true
code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null || echo 000)"
log "Health local 127.0.0.1:${PORT} → HTTP ${code}"
if [ "$code" != "200" ]; then
    warn "Últimas linhas do log (se existir container):"
    docker logs "$CONTAINER" --tail 40 2>&1 | tail -40 || true
fi
log "Nginx proxy_pass (zap-mass):"
grep -rE 'proxy_pass|zap-mass' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | grep -E '127\.0\.0\.1|proxy_pass' | head -8 || true

# 3) Imagem nova (remove inconsistência de docker cp antigo)
build_imagem_plano_b

# 4) Nginx + recria container + health (script já existente)
bash "$SELF_DIR/corrigir-site-so-carregando.sh" "$SLUG"

pub_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 "https://${DOMINIO}/api/health" 2>/dev/null || echo 000)"
if [ "$pub_code" = "200" ]; then
    ok "Site recuperado — https://${DOMINIO}/ responde HTTP 200."
else
    err "HTTPS ainda retorna HTTP ${pub_code}."
    err "Veja: docker logs ${CONTAINER} --tail 100"
    exit 1
fi
