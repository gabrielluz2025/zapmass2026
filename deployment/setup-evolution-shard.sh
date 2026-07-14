#!/usr/bin/env bash
# Ativa a 2ª instância Evolution (shard) na stack principal.
#
# USO (na VPS, como root):
#   sudo bash deployment/setup-evolution-shard.sh
#
# Define EVOLUTION_SHARD_ENABLED=1 no .env principal, cria evolution_db_2 e sobe evolution-2.
# Novos clientes (novo-cliente.sh) passam a ser balanceados entre evolution e evolution-2.
# Clientes existentes permanecem no shard atual (não migrar chips sem recriar instância).

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZAPMASS_ROOT="${ZAPMASS_ROOT:-$ROOT}"
ENV_FILE="${ZAPMASS_ROOT}/.env"

if [ "$(id -u)" -ne 0 ]; then
    echo "[erro] Execute como root (sudo)." >&2
    exit 1
fi

set_env_kv() {
    local key="$1" val="$2" file="$3"
    if grep -qE "^[[:space:]]*${key}=" "$file" 2>/dev/null; then
        sed -i "s|^${key}=.*|${key}=${val}|" "$file"
    else
        printf '\n%s=%s\n' "$key" "$val" >>"$file"
    fi
}

if [ ! -f "$ENV_FILE" ]; then
    echo "[erro] .env não encontrado em ${ZAPMASS_ROOT}" >&2
    exit 1
fi

echo "[zapmass] Ativando Evolution shard (2ª instância)..."
set_env_kv "EVOLUTION_SHARD_ENABLED" "1" "$ENV_FILE"

# shellcheck source=/dev/null
. "${ZAPMASS_ROOT}/deployment/clientes/scripts/_comum.sh"

ensure_evolution_db_shard
subir_evolution_shard_se_habilitado

echo
echo "[ok] Evolution shard ativo."
echo "  Verifique: bash deployment/evolution-shard-status.sh"
echo "  Novos clientes: sudo bash deployment/clientes/scripts/novo-cliente.sh <slug>"
