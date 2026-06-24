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
#   DISK_ALERT_PCT=70
#   AUTO_FIX_EVOLUTION=1         (sobe evolution se parado)
#   AUTO_FIX_DEMO_STOP=1         (para demo se estiver Up 24/7 por engano)

set -euo pipefail

ZAPMASS_ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
LOAD_ALERT="${LOAD_ALERT_THRESHOLD:-4}"
DISK_ALERT="${DISK_ALERT_PCT:-70}"
LOG_FILE="${ZAPMASS_MONITOR_LOG:-/var/log/zapmass-monitor.log}"
ALERT_FILE="${ZAPMASS_MONITOR_ALERTS:-/var/log/zapmass-monitor-alerts.log}"
AUTO_FIX_EVOLUTION="${AUTO_FIX_EVOLUTION:-1}"
AUTO_FIX_DEMO_STOP="${AUTO_FIX_DEMO_STOP:-1}"

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
load1_int="${load1%%.*}"
echo "${CYN}Load:${END} ${load1} (CPUs: ${cpus}, alerta se > ${LOAD_ALERT})"
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
  else
    alert "  ${name} — NÃO está Up"
    missing+=("$name")
  fi
done

# ─── Auto-fix Evolution ───────────────────────────────────────────────────────
if [ "${AUTO_FIX_EVOLUTION}" = "1" ] && ! container_running "zapmass-evolution-1"; then
  warn_msg "Tentando subir Evolution (docker compose up -d evolution)..."
  if docker compose up -d evolution 2>&1; then
    sleep 12
    if container_running "zapmass-evolution-1"; then
      ok_msg "Evolution corrigido automaticamente"
      fixes=$((fixes + 1))
      # remove evolution from missing if fixed
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
echo "${CYN}Health :3001:${END} HTTP ${hc}"
if [ "$hc" != "200" ]; then
  alert "API /api/health não retornou 200 (HTTP ${hc})"
else
  ok_msg "API saudável"
fi

# ─── Resumo docker stats ──────────────────────────────────────────────────────
echo ""
docker stats --no-stream 2>/dev/null | head -6 || true

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
