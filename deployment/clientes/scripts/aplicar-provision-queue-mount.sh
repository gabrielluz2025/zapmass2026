#!/usr/bin/env bash
# Liga o volume da fila de provisionamento em clientes já existentes (ex.: demo / checkout).
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF_DIR/_comum.sh"
exigir_root

MOUNT_LINE="      - /opt/zapmass/provision-queue:/run/provision-queue"
mkdir -p /opt/zapmass/provision-queue/pending /opt/zapmass/provision-queue/done /opt/zapmass/provision-queue/failed
chmod 750 /opt/zapmass/provision-queue

if [ ! -d "$CLIENTES_DIR" ]; then
    warn "Sem pasta clientes/"
    exit 0
fi

for dir in "${CLIENTES_DIR}"/*/; do
    [ -d "$dir" ] || continue
    slug="$(basename "$dir")"
    [[ "$slug" == *removido* ]] && continue
    compose="$(cliente_compose "$slug")"
    env_file="$(cliente_env "$slug")"
    [ -f "$compose" ] || continue

    if ! grep -q 'provision-queue:/run/provision-queue' "$compose" 2>/dev/null; then
        if grep -q '/opt/zapmass/secrets:/run/secrets:ro' "$compose"; then
            sed -i '/\/opt\/zapmass\/secrets:\/run\/secrets:ro/a\      - /opt/zapmass/provision-queue:/run/provision-queue' "$compose"
        else
            warn "Compose ${slug} sem mount secrets — adicione manualmente o volume provision-queue"
            continue
        fi
        log "Volume provision-queue adicionado em ${slug}"
    fi

    if [ -f "$env_file" ]; then
        if ! grep -qE '^[[:space:]]*ZAPMASS_PROVISION_QUEUE_DIR=' "$env_file" 2>/dev/null; then
            printf '\nZAPMASS_PROVISION_QUEUE_DIR=/run/provision-queue\n' >>"$env_file"
        fi
        # Só o site de checkout (slug demo ou PUBLIC_URL raiz) deve auto-provisionar por defeito.
        if [ "$slug" = "demo" ] && ! grep -qE '^[[:space:]]*ZAPMASS_AUTO_PROVISION=' "$env_file" 2>/dev/null; then
            printf 'ZAPMASS_AUTO_PROVISION=1\n' >>"$env_file"
        fi
    fi

    recriar_cliente_compose "$dir" "$slug"
    ok "Cliente ${slug} recriado com fila de provisionamento"
done

# Stack principal (se existir docker-compose na raiz)
if [ -f "${ZAPMASS_ROOT}/docker-compose.yml" ] && ! grep -q 'provision-queue:/run/provision-queue' "${ZAPMASS_ROOT}/docker-compose.yml"; then
    warn "Adicione manualmente em docker-compose.yml: ./provision-queue:/run/provision-queue"
fi

bash "${SELF_DIR}/setup-provision-cron.sh" >/dev/null 2>&1 || true
ok "Fila de provisionamento aplicada."
