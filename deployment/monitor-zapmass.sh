#!/usr/bin/env bash
# Monitor de HealthScore do pool (GET /api/chip-health/summary) — alertas Discord/Telegram.
#
# Uso manual na VPS:
#   sudo bash /opt/zapmass/deployment/monitor-zapmass.sh
#
# Configuração (recomendado):
#   cp deployment/chip-health-monitor.env.example /opt/zapmass/data/chip-health-monitor.env
#   chmod 600 /opt/zapmass/data/chip-health-monitor.env
#   # editar token + webhooks
#   sudo bash deployment/install-chip-health-monitor-cron.sh
#
# Variáveis:
#   ZAPMASS_ROOT=/opt/zapmass
#   ZAPMASS_MONITOR_ENV=.../data/chip-health-monitor.env
#   ZAPMASS_CHIP_HEALTH_API_URL=http://127.0.0.1:3001/api/chip-health/summary
#   ZAPMASS_MONITOR_BEARER_TOKEN=...
#   DISCORD_WEBHOOK_URL=...
#   TELEGRAM_BOT_TOKEN= + TELEGRAM_CHAT_ID=...
#   CHIP_HEALTH_CRITICAL_PLUS_THROTTLED=3  (default 3)
#   CHIP_HEALTH_AVG_SCORE_WARN=55
#   CHIP_HEALTH_ALERT_COOLDOWN_MIN=60

set -euo pipefail

ZAPMASS_ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
HOST_PORT="${ZAPMASS_HOST_PORT:-3001}"
ENV_FILE="${ZAPMASS_MONITOR_ENV:-${ZAPMASS_ROOT}/data/chip-health-monitor.env}"
LOG_FILE="${ZAPMASS_CHIP_HEALTH_LOG:-/var/log/zapmass-chip-health.log}"
STATE_FILE="${ZAPMASS_CHIP_HEALTH_STATE:-/var/log/zapmass-chip-health-state.txt}"
COOLDOWN_MIN="${CHIP_HEALTH_ALERT_COOLDOWN_MIN:-60}"
CRIT_THROTTLE_MAX="${CHIP_HEALTH_CRITICAL_PLUS_THROTTLED:-3}"
AVG_SCORE_WARN="${CHIP_HEALTH_AVG_SCORE_WARN:-55}"

if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck source=/dev/null
  . "${ENV_FILE}"
  set +a
fi

API_URL="${ZAPMASS_CHIP_HEALTH_API_URL:-http://127.0.0.1:${HOST_PORT}/api/chip-health/summary}"
TOKEN="${ZAPMASS_MONITOR_BEARER_TOKEN:-}"

log_line() {
  echo "[$(date -Iseconds)] $*" | tee -a "${LOG_FILE}" 2>/dev/null || echo "[$(date -Iseconds)] $*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log_line "ERRO: comando '$1' não encontrado (instale jq e curl)."
    exit 1
  }
}

require_cmd curl
require_cmd jq

if [ -z "${TOKEN}" ]; then
  log_line "ERRO: ZAPMASS_MONITOR_BEARER_TOKEN ausente. Configure ${ENV_FILE}"
  exit 1
fi

if [ -z "${DISCORD_WEBHOOK_URL:-}" ] && { [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; }; then
  log_line "AVISO: nenhum canal de alerta (Discord ou Telegram). Métricas só no log."
fi

HTTP_CODE=""
RESPONSE="$(
  curl -sS -w '\n%{http_code}' -H "Authorization: Bearer ${TOKEN}" --max-time 20 "${API_URL}" 2>/dev/null || true
)"
HTTP_CODE="$(echo "${RESPONSE}" | tail -n1)"
RESPONSE="$(echo "${RESPONSE}" | sed '$d')"

if [ -z "${RESPONSE}" ] || [ "${HTTP_CODE}" != "200" ]; then
  log_line "CRÍTICO: API indisponível (HTTP ${HTTP_CODE:-?}). URL=${API_URL}"
  exit 1
fi

if ! echo "${RESPONSE}" | jq -e '.ok == true' >/dev/null 2>&1; then
  ERR="$(echo "${RESPONSE}" | jq -r '.error // "resposta inválida"' 2>/dev/null || echo 'resposta inválida')"
  log_line "CRÍTICO: summary falhou — ${ERR}"
  exit 1
fi

TOTAL="$(echo "${RESPONSE}" | jq -r '.totalChips // 0')"
AVG_SCORE="$(echo "${RESPONSE}" | jq -r '.averageScore // 0')"
CRITICAL="$(echo "${RESPONSE}" | jq -r '.distribution.critical // 0')"
DEGRADED="$(echo "${RESPONSE}" | jq -r '.distribution.degraded // 0')"
REGULAR="$(echo "${RESPONSE}" | jq -r '.distribution.regular // 0')"
EXCELLENT="$(echo "${RESPONSE}" | jq -r '.distribution.excellent // 0')"
THROTTLED="$(echo "${RESPONSE}" | jq -r '.statusCounts.throttled // 0')"
OPEN_CIRCUIT="$(echo "${RESPONSE}" | jq -r '.statusCounts.openCircuit // 0')"
PROXY_DOWN="$(echo "${RESPONSE}" | jq -r '.statusCounts.proxyDown // 0')"
QUARANTINE="$(echo "${RESPONSE}" | jq -r '.statusCounts.quarantine // 0')"
TS="$(echo "${RESPONSE}" | jq -r '.timestamp // empty')"

log_line "OK chips=${TOTAL} avg=${AVG_SCORE} exc=${EXCELLENT} reg=${REGULAR} deg=${DEGRADED} crit=${CRITICAL} throttled=${THROTTLED} open=${OPEN_CIRCUIT} proxyDown=${PROXY_DOWN}"

ALERT_NEEDED=false
SEVERITY="WARNING"
MESSAGE=""

if [ "${OPEN_CIRCUIT}" -gt 0 ] || [ "${PROXY_DOWN}" -gt 0 ]; then
  ALERT_NEEDED=true
  SEVERITY="CRITICAL"
  MESSAGE="⚠️ **Atenção urgente:** circuito aberto (${OPEN_CIRCUIT}) ou proxy down (${PROXY_DOWN}). Chips isolados do pool."
elif [ "$((CRITICAL + THROTTLED))" -gt "${CRIT_THROTTLE_MAX}" ]; then
  ALERT_NEEDED=true
  SEVERITY="WARNING"
  MESSAGE="⚡ **Degradação do pool:** ${THROTTLED} chip(s) em soft-ban (THROTTLED) e ${CRITICAL} crítico(s) (<30). Revise ritmo dos disparos."
elif awk -v avg="${AVG_SCORE}" -v lim="${AVG_SCORE_WARN}" 'BEGIN{exit !(avg>0 && avg<lim)}'; then
  ALERT_NEEDED=true
  SEVERITY="WARNING"
  MESSAGE="📉 **Score médio baixo:** ${AVG_SCORE} (limiar ${AVG_SCORE_WARN}). Pool com capacidade reduzida."
fi

should_send_alert() {
  local key="$1"
  local now epoch last=0
  now="$(date +%s)"
  if [ -f "${STATE_FILE}" ]; then
    last="$(grep -E "^${key}=" "${STATE_FILE}" 2>/dev/null | tail -1 | cut -d= -f2- || echo 0)"
  fi
  epoch=$((now - last))
  if [ "${epoch}" -lt $((COOLDOWN_MIN * 60)) ]; then
    log_line "Alerta ${key} suprimido (cooldown ${COOLDOWN_MIN}min)."
    return 1
  fi
  mkdir -p "$(dirname "${STATE_FILE}")" 2>/dev/null || true
  {
    grep -v -E "^${key}=" "${STATE_FILE}" 2>/dev/null || true
    echo "${key}=${now}"
  } >"${STATE_FILE}.tmp" 2>/dev/null && mv "${STATE_FILE}.tmp" "${STATE_FILE}" 2>/dev/null || true
  return 0
}

send_discord() {
  local color title desc
  if [ -z "${DISCORD_WEBHOOK_URL:-}" ]; then return 0; fi
  if [ "${SEVERITY}" = "CRITICAL" ]; then color=15158332; else color=16776960; fi
  title="🚨 ZapMass — Health Monitor [${SEVERITY}]"
  desc="${MESSAGE}"

  jq -n \
    --arg title "${title}" \
    --arg desc "${desc}" \
    --argjson color "${color}" \
    --arg avg "${AVG_SCORE}" \
    --arg total "${TOTAL}" \
    --arg throttled "${THROTTLED}" \
    --arg critical "${CRITICAL}" \
    --arg degraded "${DEGRADED}" \
    --arg ts "${TS:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}" \
    '{
      embeds: [{
        title: $title,
        description: $desc,
        color: $color,
        fields: [
          {name: "Média de Score", value: $avg, inline: true},
          {name: "Total Chips", value: $total, inline: true},
          {name: "Soft-Bans", value: $throttled, inline: true},
          {name: "Críticos (<30)", value: $critical, inline: true},
          {name: "Degradados (30-49)", value: $degraded, inline: true}
        ],
        timestamp: $ts
      }]
    }' | curl -sS -H "Content-Type: application/json" -X POST -d @- "${DISCORD_WEBHOOK_URL}" >/dev/null
}

send_telegram() {
  if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then return 0; fi
  local text
  text="*ZapMass Health* [${SEVERITY}]
${MESSAGE}

Média: ${AVG_SCORE} | Chips: ${TOTAL}
Throttled: ${THROTTLED} | Críticos: ${CRITICAL} | Degradados: ${DEGRADED}
Quarentena: ${QUARANTINE} | Proxy down: ${PROXY_DOWN}"
  curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "parse_mode=Markdown" \
    --data-urlencode "text=${text}" >/dev/null
}

if [ "${ALERT_NEEDED}" = true ]; then
  if should_send_alert "alert_${SEVERITY}"; then
    log_line "DISPARO ALERTA ${SEVERITY}: ${MESSAGE}"
    send_discord
    send_telegram
  fi
else
  log_line "Pool dentro dos limiares — sem alerta."
fi

exit 0
