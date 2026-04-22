#!/usr/bin/env bash
# Adiciona o bind-mount de /opt/zapmass/secrets e a variavel
# FIREBASE_SERVICE_ACCOUNT_PATH nos clientes que ja foram provisionados
# antes desta funcionalidade existir. E idempotente: se ja estiver aplicado,
# nao duplica.
#
# USO:
#   sudo bash /opt/zapmass/deployment/clientes/scripts/aplicar-firebase-admin.sh
#
# Depois de correr, cada cliente afetado e reiniciado (docker compose up -d).

set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"

exigir_root

SECRETS_DIR="/opt/zapmass/secrets"
JSON_PATH="${SECRETS_DIR}/firebase-admin.json"

mkdir -p "$SECRETS_DIR"
chmod 750 "$SECRETS_DIR"

if [ ! -f "$JSON_PATH" ]; then
    warn "Nao encontrei ${JSON_PATH}. Depois de copiares o service account para la,"
    warn "volta a correr este script (ou reinicia os containers com 'docker compose restart')."
fi

if [ ! -d "$CLIENTES_DIR" ]; then
    warn "Pasta ${CLIENTES_DIR} nao existe. Nenhum cliente provisionado."
    exit 0
fi

shopt -s nullglob
for DIR in "${CLIENTES_DIR}"/*/; do
    SLUG="$(basename "$DIR")"
    COMPOSE="${DIR}docker-compose.yml"
    ENV="${DIR}.env"
    [ -f "$COMPOSE" ] || continue

    log "Atualizando cliente: ${C_BOLD}${SLUG}${C_END}"
    ALTEROU=0

    # 1) env var no .env
    if [ -f "$ENV" ]; then
        if grep -q '^FIREBASE_SERVICE_ACCOUNT_PATH=' "$ENV"; then
            :
        elif grep -q '^# FIREBASE_SERVICE_ACCOUNT_PATH=' "$ENV"; then
            sed -i 's|^# FIREBASE_SERVICE_ACCOUNT_PATH=.*|FIREBASE_SERVICE_ACCOUNT_PATH=/run/secrets/firebase-admin.json|' "$ENV"
            ALTEROU=1
        else
            printf '\nFIREBASE_SERVICE_ACCOUNT_PATH=/run/secrets/firebase-admin.json\n' >> "$ENV"
            ALTEROU=1
        fi
    fi

    # 2) bind-mount no docker-compose.yml
    if ! grep -q '/opt/zapmass/secrets:/run/secrets' "$COMPOSE"; then
        # Insere a linha do volume logo apos a primeira linha com ":/app/data".
        sed -i '/:\/app\/data$/a\      - /opt/zapmass/secrets:/run/secrets:ro' "$COMPOSE"
        ALTEROU=1
    fi

    # 3) variavel de ambiente explicita no bloco environment (caso o .env nao carregue)
    if ! grep -q 'FIREBASE_SERVICE_ACCOUNT_PATH:' "$COMPOSE"; then
        sed -i '/PORT: "3001"/a\      FIREBASE_SERVICE_ACCOUNT_PATH: /run/secrets/firebase-admin.json' "$COMPOSE"
        ALTEROU=1
    fi

    if [ "$ALTEROU" -eq 1 ]; then
        log "  aplicado; reiniciando container..."
        (cd "$DIR" && docker compose up -d)
        ok "  cliente ${SLUG} atualizado."
    else
        ok "  cliente ${SLUG} ja estava configurado."
    fi
done

echo
ok "Concluido."
if [ ! -f "$JSON_PATH" ]; then
    warn "Lembra: coloca o ficheiro ${JSON_PATH} (chmod 600) e depois corre:"
    warn "  cd /opt/zapmass && docker compose restart"
    for DIR in "${CLIENTES_DIR}"/*/; do
        SLUG="$(basename "$DIR")"
        warn "  docker compose -f ${DIR}docker-compose.yml restart"
    done
fi
