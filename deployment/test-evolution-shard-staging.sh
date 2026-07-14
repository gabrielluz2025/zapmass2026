#!/usr/bin/env bash
# Teste de staging — Evolution sharding (Fase A) na VPS.
#
# Faz: git pull → ativa evolution-2 → provisiona clientes de teste → valida health/dispatch/shard.
#
# USO (na VPS, como root):
#   sudo bash deployment/test-evolution-shard-staging.sh
#   sudo bash deployment/test-evolution-shard-staging.sh --limpar   # remove clientes de teste ao final
#   sudo bash deployment/test-evolution-shard-staging.sh --sem-clientes  # só ativa shard + status
#
# Slugs de teste: shardtest-a, shardtest-b (subdomínios shardtest-a.zap-mass.com, etc.)

set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
ZAPMASS_ROOT="$ROOT"
cd "$ROOT"

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="${ROOT}/deployment/clientes/scripts"
# shellcheck source=/dev/null
. "${SCRIPTS}/_comum.sh"

LIMPAR=0
SEM_CLIENTES=0
SLUG_A="shardtest-a"
SLUG_B="shardtest-b"

while [ $# -gt 0 ]; do
    case "$1" in
        --limpar) LIMPAR=1; shift;;
        --sem-clientes) SEM_CLIENTES=1; shift;;
        -h|--help)
            echo "Uso: $0 [--limpar] [--sem-clientes]"
            exit 0
            ;;
        *) err "Opção desconhecida: $1"; exit 2;;
    esac
done

if [ "$(id -u)" -ne 0 ]; then
    err "Execute como root (sudo)."
    exit 1
fi

FAIL=0
ok_count=0

pass() { ok "$1"; ok_count=$((ok_count + 1)); }
fail() { err "$1"; FAIL=$((FAIL + 1)); }

check_cmd() {
    local label="$1"
    shift
    if "$@"; then
        pass "$label"
    else
        fail "$label"
    fi
}

echo "=== Teste Evolution sharding — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo

# ─── 1. Código atualizado ───────────────────────────────────────────────────
log "1/5 — Sincronizar código..."
if bash "${ROOT}/deployment/ensure-git-main.sh"; then
    pass "git em main @ $(git rev-parse --short HEAD)"
else
    fail "ensure-git-main.sh"
fi

if [ -f "${ROOT}/deployment/setup-evolution-shard.sh" ]; then
    pass "Scripts de shard presentes"
else
    fail "deployment/setup-evolution-shard.sh ausente — rode git pull"
fi

# ─── 2. Ativar evolution-2 ────────────────────────────────────────────────
log "2/5 — Ativar evolution-2..."
if bash "${ROOT}/deployment/setup-evolution-shard.sh"; then
    pass "setup-evolution-shard.sh"
else
    fail "setup-evolution-shard.sh"
fi

sleep 5
if docker ps --format '{{.Names}}' | grep -qx 'zapmass-evolution-2'; then
    pass "Container zapmass-evolution-2 UP"
else
    fail "zapmass-evolution-2 não está rodando"
fi

if evolution_shard_habilitado; then
    pass "EVOLUTION_SHARD_ENABLED=1"
else
    fail "EVOLUTION_SHARD_ENABLED não ativo no .env"
fi

echo
bash "${ROOT}/deployment/evolution-shard-status.sh" || true
echo

# ─── 3. Clientes de staging ───────────────────────────────────────────────
if [ "$SEM_CLIENTES" -eq 1 ]; then
    log "3/5 — Pulado (--sem-clientes)"
else
    log "3/5 — Provisionar clientes de teste (${SLUG_A}, ${SLUG_B})..."
    chmod +x "${SCRIPTS}"/*.sh "${ROOT}/deployment"/*.sh 2>/dev/null || true

    for slug in "$SLUG_A" "$SLUG_B"; do
        if cliente_existe "$slug"; then
            warn "Cliente ${slug} já existe — reutilizando."
            pass "Cliente ${slug} presente"
            continue
        fi
        if bash "${SCRIPTS}/novo-cliente.sh" "$slug" --tier starter; then
            pass "Provisionado ${slug}"
        else
            fail "novo-cliente.sh ${slug}"
        fi
    done
fi

# ─── 4. Validações por cliente ──────────────────────────────────────────────
log "4/5 — Health, dispatch e shard..."
for slug in "$SLUG_A" "$SLUG_B"; do
    if ! cliente_existe "$slug"; then
        if [ "$SEM_CLIENTES" -eq 1 ]; then
            continue
        fi
        fail "Cliente ${slug} ausente"
        continue
    fi

    env_file="$(cliente_env "$slug")"
    porta="$(grep -E '^HOST_PORT=' "$env_file" | sed 's/^HOST_PORT=//' | head -n1)"
    evol_url="$(grep -E '^EVOLUTION_API_URL=' "$env_file" | sed 's/^EVOLUTION_API_URL=//' | head -n1 | tr -d $'\r"\'')"
    evol_shard="$(ler_evolution_shard_cliente "$slug")"

    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${porta}/api/health" 2>/dev/null || echo 000)"
    if [ "$code" = "200" ]; then
        pass "${slug}: /api/health OK (:${porta})"
    else
        fail "${slug}: health HTTP ${code}"
    fi

    if cliente_dispatch_ok "$porta"; then
        pass "${slug}: dispatch OK"
    else
        fail "${slug}: dispatch OFF"
    fi

    if [ -n "$evol_url" ]; then
        pass "${slug}: EVOLUTION_API_URL=${evol_url} (shard ${evol_shard})"
    else
        fail "${slug}: EVOLUTION_API_URL vazio"
    fi

    conc="$(grep -E '^CAMPAIGN_WORKER_CONCURRENCY=' "$env_file" | sed 's/.*=//' | head -n1)"
    if [ "$conc" = "4" ]; then
        pass "${slug}: CAMPAIGN_WORKER_CONCURRENCY=4"
    else
        warn "${slug}: CAMPAIGN_WORKER_CONCURRENCY=${conc:-?} (esperado 4 em clientes novos)"
    fi
done

# ─── 5. Balanceamento (dois shards distintos, se possível) ─────────────────
log "5/5 — Verificar balanceamento entre shards..."
if cliente_existe "$SLUG_A" && cliente_existe "$SLUG_B"; then
    shard_a="$(ler_evolution_shard_cliente "$SLUG_A")"
    shard_b="$(ler_evolution_shard_cliente "$SLUG_B")"
    if [ "$shard_a" != "$shard_b" ]; then
        pass "Balanceamento: ${SLUG_A}→${shard_a}, ${SLUG_B}→${shard_b}"
    else
        warn "Ambos em ${shard_a} — normal se carga similar; crie mais clientes para forçar split."
    fi
fi

echo
bash "${SCRIPTS}/monitor-clientes.sh" | head -25 || true

# ─── Limpeza opcional ─────────────────────────────────────────────────────
if [ "$LIMPAR" -eq 1 ]; then
    log "Removendo clientes de teste..."
    for slug in "$SLUG_A" "$SLUG_B"; do
        if cliente_existe "$slug"; then
            bash "${SCRIPTS}/remover-cliente.sh" "$slug" --apagar-dados || warn "Falha ao remover ${slug}"
        fi
    done
    pass "Limpeza concluída"
fi

echo
echo "=== Resultado: ${ok_count} OK, ${FAIL} falha(s) ==="
if [ "$FAIL" -gt 0 ]; then
    err "Teste incompleto — corrija as falhas acima."
    exit 1
fi
ok "Teste Evolution sharding concluído com sucesso."
echo
echo "Próximos passos manuais (opcional):"
echo "  1. Abrir https://${SLUG_A}.zap-mass.com e criar uma conexão WhatsApp de teste"
echo "  2. bash deployment/evolution-shard-status.sh — confirmar +1 instância no shard certo"
echo "  3. Remover testes: sudo bash $0 --limpar"
