#!/usr/bin/env bash
# Monitor de produção ZapMass — detecta load alto, container faltando, disco cheio.
# Corrige Evolution parado automaticamente (AUTO_FIX_EVOLUTION=1, default).
#
# Uso manual:
#   sudo bash deployment/vps-monitor-producao.sh
#
# Variáveis:
#   ZAPMASS_ROOT=/opt/zapmass
#   LOAD_ALERT_THRESHOLD=4       (load 1 min, default)
#   PG_CPU_ALERT_PCT=80          (Postgres CPU com Evolution Up)
#   DISK_ALERT_PCT=70
#   AUTO_FIX_EVOLUTION=1         (sobe evolution se parado)
#   AUTO_FIX_DEMO_STOP=1         (para demo se estiver Up 24/7 por engano)

set -euo pipefail

ZAPMASS_ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
LOAD_ALERT="${LOAD_ALERT_THRESHOLD:-4}"
PG_CPU_ALERT="${PG_CPU_ALERT_PCT:-80}"
DISK_ALERT="${DISK_ALERT_PCT:-70}"
LOG_FILE="${ZAPMASS_MONITOR_LOG:-/var/log/zapmass-monitor.log}"
ALERT_FILE="${ZAPMASS_MONITOR_ALERTS:-/var/log/zapmass-monitor-alerts.log}"
HEALTH_JSON_HOST="${ZAPMASS_HEALTH_JSON:-${ZAPMASS_ROOT}/data/vps-health.json}"
AUTO_FIX_EVOLUTION="${AUTO_FIX_EVOLUTION:-1}"
AUTO_FIX_DEMO_STOP="${AUTO_FIX_DEMO_STOP:-1}"

evolution_up=0
pg_cpu_pct=""
index_ok=0
health_http=0
load15="0"
alert_messages=()

REQUIRED=(zapmass-zapmass-1 zapmass-evolution-1 zapmass-postgres-1 zapmass-redis-1)

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; CYN=$'\033[36m'; BLD=$'\033[1m'; END=$'\033[0m'

issues=0
fixes=0

log_line() {
  local msg="[$(date -Iseconds)] $*"
  echo "$msg" >>"$LOG_FILE" 2>/dev/null || true
  echo "$msg"
}

alert() {
  local msg="$1"
  issues=$((issues + 1))
  alert_messages+=("$msg")
  echo "${RED}[ALERTA]${END} $msg"
  echo "[$(date -Iseconds)] ALERTA: $msg" >>"$ALERT_FILE" 2>/dev/null || true
  log_line "ALERTA: $msg"
}

ok_msg() {
  echo "${GRN}[ok]${END} $*"
}

warn_msg() {
  echo "${YEL}[aviso]${END} $*"
}

container_running() {
  docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$1"
}

health_code() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${1}/api/health" 2>/dev/null || echo 000
}

echo ""
echo "${BLD}════════════════════════════════════════════════════════════${END}"
echo "${BLD}  ZapMass — monitor de produção${END}"
echo "${BLD}════════════════════════════════════════════════════════════${END}"
echo ""

log_line "=== início monitor ==="

if [ ! -d "$ZAPMASS_ROOT" ]; then
  alert "Raiz ${ZAPMASS_ROOT} não encontrada."
  exit 1
fi

cd "$ZAPMASS_ROOT"

# ─── Load ─────────────────────────────────────────────────────────────────────
cpus="$(nproc 2>/dev/null || echo 4)"
load1="$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo 0)"
load15="$(awk '{print $3}' /proc/loadavg 2>/dev/null || echo 0)"
load1_int="${load1%%.*}"
echo "${CYN}Load:${END} ${load1} / 15m ${load15} (CPUs: ${cpus}, alerta se > ${LOAD_ALERT})"
if awk -v l="$load1" -v t="$LOAD_ALERT" 'BEGIN{exit !(l>t)}'; then
  alert "Load 1 min elevado: ${load1} (limite ${LOAD_ALERT})"
else
  ok_msg "Load dentro do esperado"
fi

# ─── Disco ────────────────────────────────────────────────────────────────────
disk_pct="$(df / | awk 'NR==2{gsub(/%/,"",$5); print $5}')"
disk_free="$(df -h / | awk 'NR==2{print $4}')"
echo "${CYN}Disco /:${END} ${disk_pct}% usado (${disk_free} livre, alerta se > ${DISK_ALERT}%)"
if [ "${disk_pct:-0}" -gt "$DISK_ALERT" ] 2>/dev/null; then
  alert "Disco / acima de ${DISK_ALERT}% (${disk_pct}% usado)"
else
  ok_msg "Disco OK"
fi

# ─── Containers obrigatórios ──────────────────────────────────────────────────
echo ""
echo "${CYN}Containers produção:${END}"
missing=()
for name in "${REQUIRED[@]}"; do
  if container_running "$name"; then
    ok_msg "  ${name} — Up"
    [ "$name" = "zapmass-evolution-1" ] && evolution_up=1
  else
    alert "  ${name} — NÃO está Up"
    missing+=("$name")
  fi
done

# ─── Postgres CPU + índice crítico Evolution ─────────────────────────────────
if container_running "zapmass-postgres-1"; then
  pg_cpu_pct="$(docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' 2>/dev/null \
    | awk '/^zapmass-postgres-1 /{gsub(/%/,"",$2); print $2; exit}')"
  if [ -n "${pg_cpu_pct:-}" ]; then
    echo "${CYN}Postgres CPU:${END} ${pg_cpu_pct}% (alerta se > ${PG_CPU_ALERT}% com Evolution Up)"
    if [ "$evolution_up" = "1" ] && awk -v c="$pg_cpu_pct" -v t="$PG_CPU_ALERT" 'BEGIN{exit !(c>t)}'; then
      alert "Postgres CPU elevado (${pg_cpu_pct}%) com Evolution Up (limite ${PG_CPU_ALERT}%)"
    else
      ok_msg "Postgres CPU dentro do esperado"
    fi
  fi
  idx_row="$(docker exec zapmass-postgres-1 psql -U postgres -d evolution_db -tAc \
    "SELECT 1 FROM pg_indexes WHERE indexname='idx_message_instance_remote_jid_ts' LIMIT 1;" 2>/dev/null || true)"
  if [ "${idx_row// /}" = "1" ]; then
    index_ok=1
    ok_msg "Índice idx_message_instance_remote_jid_ts presente"
  else
    alert "Índice idx_message_instance_remote_jid_ts AUSENTE — risco de load alto no Postgres"
  fi
fi

# ─── Auto-fix Evolution ───────────────────────────────────────────────────────
if [ "${AUTO_FIX_EVOLUTION}" = "1" ] && ! container_running "zapmass-evolution-1"; then
  warn_msg "Tentando subir Evolution (docker compose up -d evolution)..."
  if docker compose up -d evolution 2>&1; then
    sleep 12
    if container_running "zapmass-evolution-1"; then
      ok_msg "Evolution corrigido automaticamente"
      fixes=$((fixes + 1))
      evolution_up=1
      missing=("${missing[@]/zapmass-evolution-1/}")
    else
      alert "Evolution não subiu após compose up — ver docker logs zapmass-evolution-1"
    fi
  else
    alert "docker compose up -d evolution falhou"
  fi
fi

# ─── Demo acidental 24/7 ──────────────────────────────────────────────────────
if [ "${AUTO_FIX_DEMO_STOP}" = "1" ] && container_running "zapmass-cli-demo"; then
  warn_msg "Demo está Up (não deveria 24/7) — parando..."
  if [ -f "${ZAPMASS_ROOT}/deployment/clientes/scripts/parar-cliente.sh" ]; then
    bash "${ZAPMASS_ROOT}/deployment/clientes/scripts/parar-cliente.sh" demo 2>/dev/null || docker stop zapmass-cli-demo 2>/dev/null || true
  else
    docker stop zapmass-cli-demo 2>/dev/null || true
  fi
  ok_msg "Demo parado automaticamente"
  fixes=$((fixes + 1))
fi

# ─── Health API ───────────────────────────────────────────────────────────────
echo ""
hc="$(health_code 3001)"
health_http="$hc"
echo "${CYN}Health :3001:${END} HTTP ${hc}"
if [ "$hc" != "200" ]; then
  alert "API /api/health não retornou 200 (HTTP ${hc})"
else
  ok_msg "API saudável"
fi

# ─── Resumo docker stats ──────────────────────────────────────────────────────
echo ""
docker stats --no-stream 2>/dev/null | head -6 || true

# Releitura pós auto-fix (Evolution pode ter subido; CPU do PG muda)
if container_running "zapmass-postgres-1"; then
  pg_cpu_pct="$(docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' 2>/dev/null \
    | awk '/^zapmass-postgres-1 /{gsub(/%/,"",$2); print $2; exit}')"
fi
container_running "zapmass-evolution-1" && evolution_up=1

# ─── Snapshot JSON (painel admin) ─────────────────────────────────────────────
write_health_json() {
  local ok_flag=false
  [ "$issues" -eq 0 ] && ok_flag=true
  local at_iso pg_field alerts_arr containers_arr
  at_iso="$(date -Iseconds)"
  if [ -n "${pg_cpu_pct:-}" ]; then
    pg_field="$pg_cpu_pct"
  else
    pg_field="null"
  fi
  alerts_arr=""
  for msg in "${alert_messages[@]:-}"; do
    local esc="${msg//\\/\\\\}"
    esc="${esc//\"/\\\"}"
    if [ -n "$alerts_arr" ]; then alerts_arr+=","; fi
    alerts_arr+="\"${esc}\""
  done
  containers_arr=""
  for name in "${REQUIRED[@]}"; do
    local up="false"
    container_running "$name" && up="true"
    if [ -n "$containers_arr" ]; then containers_arr+=","; fi
    containers_arr+="{\"name\":\"${name}\",\"up\":${up}}"
  done
  local json
  json="$(cat <<EOF
{
  "at": "${at_iso}",
  "source": "${ZAPMASS_MONITOR_SOURCE:-cron}",
  "ok": ${ok_flag},
  "issueCount": ${issues},
  "fixCount": ${fixes},
  "evolutionRecovered": $([ "$fixes" -gt 0 ] && container_running "zapmass-evolution-1" && echo true || echo false),
  "load1": ${load1},
  "load15": ${load15},
  "cpus": ${cpus},
  "diskPct": ${disk_pct:-0},
  "diskFree": "${disk_free:-}",
  "evolutionUp": $([ "$evolution_up" = "1" ] && echo true || echo false),
  "indexOk": $([ "$index_ok" = "1" ] && echo true || echo false),
  "healthHttp": ${health_http:-0},
  "postgresCpuPct": ${pg_field},
  "containers": [${containers_arr}],
  "alerts": [${alerts_arr}],
  "cronSchedule": "0 9 * * 1",
  "cronMarker": "/etc/cron.d/zapmass-monitor-producao"
}
EOF
)"
  mkdir -p "$(dirname "$HEALTH_JSON_HOST")" 2>/dev/null || true
  echo "$json" >"$HEALTH_JSON_HOST" 2>/dev/null || true
  if container_running "zapmass-zapmass-1"; then
    echo "$json" | docker exec -i zapmass-zapmass-1 tee /app/data/vps-health.json >/dev/null 2>&1 || true
  fi
}

write_health_json

# ─── Resultado ────────────────────────────────────────────────────────────────
echo ""
if [ "$issues" -eq 0 ]; then
  echo "${GRN}${BLD}Monitor OK — nenhum problema detectado.${END}"
  [ "$fixes" -gt 0 ] && echo "${GRN}Correções automáticas aplicadas: ${fixes}${END}"
  log_line "=== fim monitor OK (fixes=${fixes}) ==="
  exit 0
fi

echo "${RED}${BLD}Monitor detectou ${issues} problema(s).${END}"
[ "$fixes" -gt 0 ] && echo "${YEL}Correções automáticas: ${fixes}${END}"
echo "Log: ${LOG_FILE}"
echo "Alertas: ${ALERT_FILE}"
log_line "=== fim monitor COM ${issues} alerta(s) (fixes=${fixes}) ==="
exit 1
