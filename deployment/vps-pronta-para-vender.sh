#!/usr/bin/env bash
# Checklist automatizado — VPS pronta para vender ZapMass (Plano B).
#
# Uso (terminal Hostinger ou SSH root):
#   cd /opt/zapmass && sudo bash deployment/vps-pronta-para-vender.sh
#
# Opções:
#   --aplicar   Instala crons e corrige REDIS/rede (sem pedir confirmação)
#   --somente-check   Só valida, não altera nada

set -euo pipefail
cd /opt/zapmass

SCRIPTS="deployment/clientes/scripts"
# shellcheck source=deployment/clientes/scripts/_comum.sh
. "${SCRIPTS}/_comum.sh"

APLICAR=0
SOMENTE_CHECK=0
FALHAS=0

while [ $# -gt 0 ]; do
    case "$1" in
        --aplicar) APLICAR=1; shift;;
        --somente-check) SOMENTE_CHECK=1; shift;;
        *) shift;;
    esac
done

if [ "$(id -u)" -ne 0 ]; then
    err "Execute como root: sudo bash deployment/vps-pronta-para-vender.sh"
    exit 1
fi

garantir_scripts_executaveis_clientes

_check() {
    local ok_msg="$1"
    shift
    if "$@"; then
        ok "$ok_msg"
        return 0
    fi
    err "FALHOU: $ok_msg"
    FALHAS=$((FALHAS + 1))
    return 1
}

echo "=============================================="
echo " ZapMass — VPS pronta para vender (Plano B)"
echo " $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=============================================="
echo

log "1) Stack Docker principal"
_check "Docker ativo" docker info >/dev/null 2>&1
_check "Compose em /opt/zapmass" test -f docker-compose.yml
if docker compose ps 2>/dev/null | grep -qE 'redis|zapmass'; then
    ok "Serviços redis/zapmass presentes"
else
    err "FALHOU: redis/zapmass não encontrados — rode: docker compose up -d"
    FALHAS=$((FALHAS + 1))
fi

log "2) Imagem Plano B"
if docker image inspect zapmass-zapmass:latest >/dev/null 2>&1; then
    ok "Imagem zapmass-zapmass:latest OK"
else
    err "FALHOU: imagem zapmass-zapmass:latest ausente — rode deploy ou docker compose build"
    FALHAS=$((FALHAS + 1))
fi

log "3) REDIS_URL + rede partilhada"
if grep -qE 'host\.docker\.internal|redis://localhost' .env 2>/dev/null; then
    warn "REDIS_URL legada no .env principal"
    if [ "$APLICAR" -eq 1 ] && [ "$SOMENTE_CHECK" -eq 0 ]; then
        bash deployment/fix-redis-url-all.sh || true
    else
        FALHAS=$((FALHAS + 1))
        echo "       Corrija: bash deployment/fix-redis-url-all.sh"
    fi
else
    ok "REDIS_URL principal sem host legado"
fi

_shared_net="$(redis_compose_network 2>/dev/null || compose_shared_network 2>/dev/null || true)"
if [ -n "${_shared_net}" ]; then
    ok "Rede Redis: ${_shared_net}"
else
    err "FALHOU: rede partilhada Redis não detectada"
    FALHAS=$((FALHAS + 1))
fi

log "4) Cliente produção (zap-mass.com)"
read -r prod_slug prod_port prod_dom <<<"$(resolver_cliente_producao)"
prod_port="${prod_port:-3100}"
prod_dom="${prod_dom:-zap-mass.com}"
echo "   slug=${prod_slug} porta=${prod_port} domínio=${prod_dom}"

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 "http://127.0.0.1:${prod_port}/api/health" 2>/dev/null || echo 000)"
if [ "$code" = "200" ]; then
    ok "Health local :${prod_port} → HTTP 200"
else
    err "FALHOU: health local :${prod_port} → HTTP ${code}"
    FALHAS=$((FALHAS + 1))
fi

if cliente_dispatch_ok "$prod_port"; then
    ok "Dispatch local :${prod_port} → ok:true"
else
    err "FALHOU: /api/health/dispatch em :${prod_port}"
    if [ "$APLICAR" -eq 1 ] && [ "$SOMENTE_CHECK" -eq 0 ]; then
        bash deployment/fix-redis-url-all.sh || true
        sleep 5
        if cliente_dispatch_ok "$prod_port"; then
            ok "Dispatch recuperado após auto-fix (:${prod_port})"
        else
            FALHAS=$((FALHAS + 1))
        fi
    else
        FALHAS=$((FALHAS + 1))
    fi
fi

if [ -d "${CLIENTES_DIR}/${prod_slug}" ]; then
    cname="zapmass-cli-${prod_slug}"
    if docker inspect "$cname" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null \
        | grep -q "${_shared_net:-zapmass_default}"; then
        ok "Cliente ${prod_slug} ligado à rede Redis"
    else
        warn "Cliente ${prod_slug} pode estar isolado da rede Redis"
        if [ "$APLICAR" -eq 1 ] && [ "$SOMENTE_CHECK" -eq 0 ]; then
            ligar_cliente_rede_compose "$prod_slug" || true
        else
            FALHAS=$((FALHAS + 1))
        fi
    fi
fi

log "5) Nginx + SSL + rate limit"
_check "Nginx instalado" command -v nginx
_check "nginx -t" nginx -t
if [ -f /etc/nginx/conf.d/zapmass-rate-limit.conf ] || grep -rq 'limit_req_zone.*zapmass' /etc/nginx 2>/dev/null; then
    ok "Rate limit Nginx configurado"
else
    warn "Rate limit Nginx não detectado"
    if [ "$APLICAR" -eq 1 ] && [ "$SOMENTE_CHECK" -eq 0 ]; then
        bash "${SCRIPTS}/setup-nginx-rate-limit.sh" || true
    fi
fi
if command -v certbot >/dev/null 2>&1; then
    ok "Certbot instalado"
else
    warn "Certbot ausente — HTTPS automático indisponível"
fi

log "6) Segredos e billing"
_vps_auth="$(grep -E '^ZAPMASS_AUTH_PROVIDER=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"'"'"' ' | tr '[:upper:]' '[:lower:]' || echo vps)"
_vps_data="$(grep -E '^ZAPMASS_DATA_PROVIDER=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"'"'"' ' | tr '[:upper:]' '[:lower:]' || echo vps)"
if [ "$_vps_auth" = "vps" ] && [ "$_vps_data" = "vps" ]; then
    ok "Modo VPS puro — Firebase não necessário (auth/dados Postgres)"
elif [ -f /opt/zapmass/secrets/firebase-admin.json ]; then
    ok "firebase-admin.json presente"
else
    warn "firebase-admin.json ausente — trial/webhooks Firestore retornam 503"
fi
if grep -qE '^[[:space:]]*MERCADOPAGO_ACCESS_TOKEN=.+' .env 2>/dev/null; then
    ok "MERCADOPAGO_ACCESS_TOKEN configurado"
else
    warn "MERCADOPAGO_ACCESS_TOKEN vazio — checkout desativado"
fi
if grep -qE '^[[:space:]]*MERCADOPAGO_WEBHOOK_SECRET=.+' .env 2>/dev/null; then
    ok "MERCADOPAGO_WEBHOOK_SECRET configurado"
else
    warn "MERCADOPAGO_WEBHOOK_SECRET ausente — webhook MP inseguro em produção"
fi

log "7) Fila pós-pagamento + crons operacionais"
mkdir -p /opt/zapmass/provision-queue/pending /opt/zapmass/provision-queue/done /opt/zapmass/provision-queue/failed
chmod 750 /opt/zapmass/provision-queue 2>/dev/null || true
ok "Diretório provision-queue criado"

for cron_script in setup-backup-cron.sh setup-monitor-cron.sh setup-provision-cron.sh; do
    if [ -f "/etc/cron.d/zapmass-${cron_script#setup-}" ] 2>/dev/null; then
        :
    fi
done

if [ -f /etc/cron.d/zapmass-clientes-backup ]; then
    ok "Cron backup diário instalado"
else
    warn "Cron backup ausente"
    if [ "$APLICAR" -eq 1 ] && [ "$SOMENTE_CHECK" -eq 0 ]; then
        bash "${SCRIPTS}/setup-backup-cron.sh" || true
    fi
fi
if [ -f /etc/cron.d/zapmass-monitor ]; then
    ok "Cron monitor (15 min) instalado"
else
    warn "Cron monitor ausente"
    if [ "$APLICAR" -eq 1 ] && [ "$SOMENTE_CHECK" -eq 0 ]; then
        bash "${SCRIPTS}/setup-monitor-cron.sh" || true
    fi
fi
if [ -f /etc/cron.d/zapmass-provision ]; then
    ok "Cron provisionamento (5 min) instalado"
else
    warn "Cron provisionamento ausente"
    if [ "$APLICAR" -eq 1 ] && [ "$SOMENTE_CHECK" -eq 0 ]; then
        bash "${SCRIPTS}/setup-provision-cron.sh" || true
    fi
fi

if [ "$APLICAR" -eq 1 ] && [ "$SOMENTE_CHECK" -eq 0 ]; then
    if [ -f "${SCRIPTS}/aplicar-provision-queue-mount.sh" ]; then
        log "Aplicando volume provision-queue nos clientes..."
        bash "${SCRIPTS}/aplicar-provision-queue-mount.sh" || warn "Mount provision-queue falhou (aplicar manualmente)"
    fi
fi

demo_env="${CLIENTES_DIR}/demo/.env"
if [ -f "$demo_env" ]; then
    if grep -qE '^[[:space:]]*ZAPMASS_AUTO_PROVISION=1' "$demo_env" 2>/dev/null; then
        ok "ZAPMASS_AUTO_PROVISION=1 no checkout (demo)"
    else
        warn "ZAPMASS_AUTO_PROVISION ausente no demo — webhook MP não enfileira novos clientes"
        if [ "$APLICAR" -eq 1 ] && [ "$SOMENTE_CHECK" -eq 0 ]; then
            if ! grep -qE '^[[:space:]]*ZAPMASS_AUTO_PROVISION=' "$demo_env" 2>/dev/null; then
                printf 'ZAPMASS_AUTO_PROVISION=1\n' >>"$demo_env"
                ok "ZAPMASS_AUTO_PROVISION=1 adicionado ao demo"
            fi
        fi
    fi
fi

log "8) Monitor rápido de todos os clientes"
if [ -d "$CLIENTES_DIR" ] && [ -n "$(ls -A "$CLIENTES_DIR" 2>/dev/null || true)" ]; then
    bash "${SCRIPTS}/monitor-clientes.sh" || FALHAS=$((FALHAS + 1))
else
    log "Nenhum cliente em clientes/ (exceto migração futura)."
fi

echo
echo "=============================================="
if [ "$FALHAS" -eq 0 ]; then
    ok "VPS PRONTA para vender (${FALHAS} falhas)"
    echo
    echo "Próximo cliente manual:"
    echo "  sudo bash ${SCRIPTS}/novo-cliente.sh <slug> --tier pro"
    echo
    echo "Pós-pagamento automático:"
    echo "  1. ZAPMASS_AUTO_PROVISION=1 no .env do site de checkout"
    echo "  2. Webhook MP → fila → cron processar-fila-provision.sh"
    echo "  3. Ver fila: ls -la /opt/zapmass/provision-queue/pending/"
    exit 0
fi

err "VPS com ${FALHAS} item(ns) pendente(s). Rode com --aplicar para corrigir o que for automático:"
echo "  sudo bash deployment/vps-pronta-para-vender.sh --aplicar"
exit 1
