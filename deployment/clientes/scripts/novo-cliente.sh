#!/usr/bin/env bash
# Provisiona uma nova instancia isolada do ZapMass para um cliente.
#
# USO:
#   sudo bash /opt/zapmass/deployment/clientes/scripts/novo-cliente.sh <slug> [--dominio dominio.exemplo.com] [--sem-ssl]
#
# EXEMPLOS:
#   sudo bash .../novo-cliente.sh acme
#       -> cria acme.zap-mass.com (usa dominio raiz do .env global)
#
#   sudo bash .../novo-cliente.sh acme --dominio whatsapp.acme.com
#       -> cria com dominio proprio do cliente
#
#   sudo bash .../novo-cliente.sh teste --sem-ssl
#       -> NAO tenta emitir certificado (util para teste rapido)
#
# O QUE FAZ:
#   1. Valida slug e dominio.
#   2. Escolhe porta livre (3100+).
#   3. Cria /opt/zapmass/clientes/<slug>/ com docker-compose.yml, .env e pasta data/.
#   4. Sobe o container (reutiliza a imagem zapmass-zapmass:latest ja construida).
#   5. Cria virtual-host Nginx para <dominio> -> 127.0.0.1:<porta>.
#   6. Se tiver SSL disponivel, corre certbot para emitir HTTPS.
#   7. Guarda metadados em cliente.json.

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"

exigir_root

SLUG_RAW="${1:-}"
if [ -z "$SLUG_RAW" ]; then
    err "Uso: $0 <slug> [--dominio dominio.com] [--sem-ssl]"
    exit 2
fi
shift || true

DOMINIO=""
DOMINIO_RAIZ="${ZAPMASS_DOMINIO_RAIZ:-zap-mass.com}"
USAR_SSL=1

while [ $# -gt 0 ]; do
    case "$1" in
        --dominio|-d)
            DOMINIO="${2:-}"; shift 2;;
        --sem-ssl)
            USAR_SSL=0; shift;;
        *)
            err "Opcao desconhecida: $1"; exit 2;;
    esac
done

SLUG="$(normalizar_slug "$SLUG_RAW")"
if [ -z "$DOMINIO" ]; then DOMINIO="${SLUG}.${DOMINIO_RAIZ}"; fi

log "Provisionando cliente: ${C_BOLD}${SLUG}${C_END} em ${C_BOLD}${DOMINIO}${C_END}"

if cliente_existe "$SLUG"; then
    err "Cliente '$SLUG' ja existe em $(cliente_dir "$SLUG"). Remove primeiro com remover-cliente.sh."
    exit 1
fi

if [ ! -f "${TEMPLATES_DIR}/docker-compose.cliente.yml.template" ]; then
    err "Templates nao encontrados em ${TEMPLATES_DIR}. Executa 'git pull' em ${ZAPMASS_ROOT}."
    exit 1
fi

# Confirmar que a imagem base ja foi construida. Se nao, constroi a partir de /opt/zapmass.
if ! docker image inspect zapmass-zapmass:latest >/dev/null 2>&1; then
    log "Imagem zapmass-zapmass:latest nao encontrada. A construir a partir de ${ZAPMASS_ROOT}..."
    (cd "$ZAPMASS_ROOT" && docker compose build)
fi

PORTA="$(proxima_porta_livre)"
BACKUP_KEY="$(gerar_chave)"
DIR="$(cliente_dir "$SLUG")"
DATA_DIR="$(cliente_data "$SLUG")"

log "Porta atribuida: ${PORTA}"
log "Pasta do cliente: ${DIR}"

mkdir -p "$DIR" "$DATA_DIR"
chown -R root:root "$DIR"
chmod 750 "$DIR"

render_template \
    "${TEMPLATES_DIR}/cliente.env.template" \
    "${DIR}/.env" \
    "SLUG=${SLUG}" \
    "DOMAIN=${DOMINIO}" \
    "BACKUP_KEY=${BACKUP_KEY}"
# Acrescenta HOST_PORT no .env para que scripts futuros possam descobri-la.
printf '\nHOST_PORT=%s\n' "$PORTA" >> "${DIR}/.env"
chmod 600 "${DIR}/.env"

render_template \
    "${TEMPLATES_DIR}/docker-compose.cliente.yml.template" \
    "${DIR}/docker-compose.yml" \
    "SLUG=${SLUG}" \
    "HOST_PORT=${PORTA}" \
    "DATA_DIR=${DATA_DIR}"

cat > "$(cliente_meta "$SLUG")" <<EOF
{
  "slug": "${SLUG}",
  "dominio": "${DOMINIO}",
  "host_port": ${PORTA},
  "criado_em": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "ssl": $( [ "$USAR_SSL" -eq 1 ] && echo true || echo false )
}
EOF

log "Subindo container zapmass-cli-${SLUG} na porta ${PORTA}..."
(cd "$DIR" && docker compose up -d)

log "Aguardando o container ficar saudavel (ate 60s)..."
OK=0
for i in $(seq 1 20); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORTA}/api/health" || echo 000)"
    if [ "$code" = "200" ]; then OK=1; break; fi
    sleep 3
done
if [ "$OK" -ne 1 ]; then
    err "Container nao respondeu 200 em /api/health. Ver logs com:"
    err "  docker compose -f ${DIR}/docker-compose.yml logs --tail=100"
    exit 1
fi
ok "Container do cliente '${SLUG}' saudavel."

log "Configurando Nginx para ${DOMINIO}..."
NGINX_FILE="${NGINX_AVAILABLE}/zapmass-${SLUG}"
render_template \
    "${TEMPLATES_DIR}/nginx-cliente.conf.template" \
    "${NGINX_FILE}" \
    "DOMAIN=${DOMINIO}" \
    "HOST_PORT=${PORTA}"
ln -sf "$NGINX_FILE" "${NGINX_ENABLED}/zapmass-${SLUG}"

if ! nginx -t 2>/dev/null; then
    err "nginx -t falhou. A reverter link e ficheiro."
    rm -f "${NGINX_ENABLED}/zapmass-${SLUG}" "$NGINX_FILE"
    exit 1
fi
systemctl reload nginx
ok "Nginx carregou virtual-host para ${DOMINIO}."

if [ "$USAR_SSL" -eq 1 ]; then
    if command -v certbot >/dev/null 2>&1; then
        log "Solicitando certificado Let's Encrypt para ${DOMINIO}..."
        if certbot --nginx -d "${DOMINIO}" --non-interactive --agree-tos --redirect \
            -m "${ZAPMASS_CERTBOT_EMAIL:-admin@${DOMINIO_RAIZ}}"; then
            ok "HTTPS ativo em https://${DOMINIO}."
        else
            warn "Certbot falhou. O site continua disponivel em HTTP:"
            warn "  http://${DOMINIO}"
            warn "Confirma que o DNS de ${DOMINIO} aponta para este servidor e tenta depois:"
            warn "  sudo certbot --nginx -d ${DOMINIO}"
        fi
    else
        warn "certbot nao instalado. Instala com: sudo apt install -y certbot python3-certbot-nginx"
    fi
else
    warn "SSL saltado (--sem-ssl). Site disponivel so em HTTP."
fi

echo
ok "Cliente ${C_BOLD}${SLUG}${C_END} pronto."
echo "  URL:        https://${DOMINIO}"
echo "  Porta host: ${PORTA}"
echo "  Pasta:      ${DIR}"
echo "  Backup key: ${BACKUP_KEY}  (guarda se fores usar /api/backup)"
echo
echo "Comandos uteis:"
echo "  sudo bash ${SELF_DIR}/listar-clientes.sh"
echo "  sudo bash ${SELF_DIR}/parar-cliente.sh ${SLUG}"
echo "  sudo bash ${SELF_DIR}/iniciar-cliente.sh ${SLUG}"
echo "  sudo bash ${SELF_DIR}/backup-cliente.sh ${SLUG}"
echo "  sudo bash ${SELF_DIR}/remover-cliente.sh ${SLUG}"
