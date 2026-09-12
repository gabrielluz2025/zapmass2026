#!/usr/bin/env bash
# Diagnóstico completo do pool (Fase 0 warmup) — summary + detail + monitor.
# Uso: cd /opt/zapmass && bash deployment/warmup-pool-check.sh

set -euo pipefail

ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
ENV_FILE="${ROOT}/data/chip-health-monitor.env"
MAIN_ENV="${ROOT}/.env"
BASELINE="${ROOT}/data/chip-health-baseline.json"
SNAP_DIR="${ROOT}/data/pool-snapshots"
HOST_PORT="${ZAPMASS_HOST_PORT:-3001}"
API="http://127.0.0.1:${HOST_PORT}"

cd "${ROOT}"

if ! command -v jq >/dev/null 2>&1; then
  echo "==> Instalando jq..."
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq jq
fi

if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck source=/dev/null
  . "${ENV_FILE}"
  set +a
fi

if [ -z "${ZAPMASS_INTERNAL_MONITOR_KEY:-}" ] && [ -f "${MAIN_ENV}" ]; then
  ZAPMASS_INTERNAL_MONITOR_KEY="$(grep -E '^[[:space:]]*ZAPMASS_INTERNAL_MONITOR_KEY=' "${MAIN_ENV}" | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
fi

curl_chip_api() {
  local path="$1"
  if [ -n "${ZAPMASS_INTERNAL_MONITOR_KEY:-}" ]; then
    if out="$(curl -sf -H "X-Internal-Secret: ${ZAPMASS_INTERNAL_MONITOR_KEY}" "${API}${path}" 2>/dev/null)"; then
      echo "${out}"
      return 0
    fi
  fi
  docker compose exec -T zapmass curl -sf "http://127.0.0.1:3001${path}" 2>/dev/null
}

echo "=============================================="
echo " ZapMass — Checkup pool + warmup (Fase 0)"
echo " $(date -Iseconds)"
echo "=============================================="
echo ""

VER="$(curl -sf "${API}/api/version" | jq -r '.version // "?"')"
echo "==> Versão API: ${VER}"
echo ""

echo "==> Resumo (/api/chip-health/summary)"
SUMMARY="$(curl_chip_api /api/chip-health/summary)" || {
  echo "ERRO: não foi possível ler summary (confira ZAPMASS_INTERNAL_MONITOR_KEY no .env)"
  exit 1
}
echo "${SUMMARY}" | jq .

if [ "$(echo "${SUMMARY}" | jq -r '.ok // false')" != "true" ]; then
  echo "ERRO summary: $(echo "${SUMMARY}" | jq -r '.error // .')"
  exit 1
fi

AVG="$(echo "${SUMMARY}" | jq -r '.averageScore // 0')"
TOTAL="$(echo "${SUMMARY}" | jq -r '.totalChips // 0')"
QUAR="$(echo "${SUMMARY}" | jq -r '.statusCounts.quarantine // 0')"
THR="$(echo "${SUMMARY}" | jq -r '.statusCounts.throttled // 0')"
OPEN="$(echo "${SUMMARY}" | jq -r '.statusCounts.openCircuit // 0')"
PROXY="$(echo "${SUMMARY}" | jq -r '.statusCounts.proxyDown // 0')"

mkdir -p "${SNAP_DIR}"
STAMP="$(date +%Y%m%d-%H%M%S)"
SNAP_FILE="${SNAP_DIR}/chip-health-${STAMP}.json"
echo "${SUMMARY}" | jq . >"${SNAP_FILE}"
echo ""
echo "    Snapshot: ${SNAP_FILE}"

if [ -f "${BASELINE}" ]; then
  BASE_AVG="$(jq -r '.averageScore // 0' "${BASELINE}")"
  echo "==> Baseline média ${BASE_AVG} → agora ${AVG}"
fi

echo ""
echo "==> Detalhe por chip (/api/chip-health/detail)"
DETAIL="$(curl_chip_api /api/chip-health/detail 2>/dev/null || true)"
if [ -n "${DETAIL}" ] && [ "$(echo "${DETAIL}" | jq -r '.ok // false')" = "true" ]; then
  echo "${DETAIL}" | jq '{tenantId, chips: [.chips[] | {grupo: .warmupGroup, nome: .name, score, tier: .tierLabel, capDia: .suggestedDailyCap, circuit: .circuitState}]}'
else
  echo "    Endpoint detail indisponível nesta versão (${VER})."
  echo "    Atualize: git pull origin main && docker compose up -d --build"
  echo "    Enquanto isso: use UI → Proteção de Chips para ver score por chip."
fi

echo ""
echo "==> Monitor"
bash "${ROOT}/deployment/monitor-zapmass.sh" || true

echo ""
echo "=============================================="
echo " Chips: ${TOTAL} | Média: ${AVG} | Quarentena: ${QUAR}"
if awk "BEGIN { exit !(${AVG} < 55) }"; then
  echo "  → Priorize aquecimento (15–20 min), sem campanha pesada."
elif awk "BEGIN { exit !(${AVG} < 75) }"; then
  echo "  → Piloto 30–50 contatos/dia (grupo C)."
else
  echo "  → Pool ok para escala gradual."
fi
echo " UI: Aquecimento → 6 chips → Verificar riscos → Iniciar"
echo " Diário: bash ${ROOT}/deployment/warmup-pool-check.sh"
echo "=============================================="
