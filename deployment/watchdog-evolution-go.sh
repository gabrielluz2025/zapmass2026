#!/usr/bin/env bash
# Watchdog do Evolution Go (produção + homolog).
# Verifica se os containers estão rodando e saudáveis; reinicia se caírem.
# Executado pelo cron a cada 2 minutos via install-evolution-go-watchdog.sh.
#
# Uso manual: sudo bash deployment/watchdog-evolution-go.sh
set -euo pipefail

ZAPMASS_ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
LOG="${EVOLUTION_GO_WATCHDOG_LOG:-/var/log/zapmass-evolution-go-watchdog.log}"
MAX_LOG_LINES=2000

cd "$ZAPMASS_ROOT" 2>/dev/null || true

_log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$msg"
  echo "$msg" >>"$LOG" 2>/dev/null || true
}

# Rotação leve do log
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG" 2>/dev/null || echo 0)" -gt "$MAX_LOG_LINES" ]; then
  tail -n $((MAX_LOG_LINES / 2)) "$LOG" > "${LOG}.tmp" 2>/dev/null && mv "${LOG}.tmp" "$LOG" 2>/dev/null || true
fi

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
touch "$LOG" 2>/dev/null || true

# ─── Verifica um container do Evolution Go ──────────────────────────────────
check_and_fix() {
  local container="$1"        # ex: zapmass-evolution-go
  local port="$2"             # porta no host (ex: 8081)
  local compose_file="${3:-}" # ex: docker-compose.homolog.yml (vazio = produção)

  local running
  running="$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null || echo 'missing')"

  if [ "$running" = "true" ]; then
    # Garante política restart=always sem recriar
    docker update --restart=always "$container" >/dev/null 2>&1 || true

    # Respeitar período de inicialização: Evolution Go leva até 90s para subir completamente.
    # Não reiniciar containers que acabaram de iniciar — evita loop de restarts.
    local started_at uptime_sec
    started_at="$(docker inspect --format '{{.State.StartedAt}}' "$container" 2>/dev/null || echo '')"
    if [ -n "$started_at" ]; then
      uptime_sec=$(( $(date +%s) - $(date -d "$started_at" +%s 2>/dev/null || echo "$(date +%s)") ))
      if [ "${uptime_sec:-0}" -lt 90 ]; then
        _log "SKIP $container — iniciando há ${uptime_sec}s (aguarda 90s antes de reiniciar)"
        return 0
      fi
    fi

    # Mesmo critério do healthcheck do compose: GET /instance/all.
    # GET / devolve 404 e /instance/all sem API key devolve 401 — os dois significam
    # que o processo está no ar. curl -f trata 4xx como falha e reiniciava o Go
    # (chips WhatsApp caíam a cada ~2 min após o grace de 90s).
    local http_ok=0
    local code=""
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${port}/instance/all" 2>/dev/null || true)"
    case "$code" in
      200|401|403) http_ok=1 ;;
    esac
    if [ "$http_ok" != "1" ]; then
      if wget -SO- --timeout=5 "http://127.0.0.1:${port}/instance/all" 2>&1 | grep -qE 'HTTP/[0-9.]+ (200|401|403)'; then
        http_ok=1
      fi
    fi

    if [ "$http_ok" = "1" ]; then
      _log "OK  $container (porta $port)"
      return 0
    fi

    _log "WARN $container está rodando há ${uptime_sec:-?}s mas não responde na porta $port — restart"
    docker restart "$container" >/dev/null 2>&1 || true
    sleep 10
    return 0
  fi

  # Container parado ou ausente
  _log "DOWN $container (estado: $running) — tentando subir"

  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$container"; then
    # Existe mas parado — apenas iniciar
    docker start "$container" >/dev/null 2>&1 || true
    docker update --restart=always "$container" >/dev/null 2>&1 || true
    sleep 8
    local r2
    r2="$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null || echo 'missing')"
    if [ "$r2" = "true" ]; then
      _log "OK  $container recuperado via docker start"
      return 0
    fi
    _log "WARN docker start não foi suficiente — tentando compose up"
  fi

  # Recriar via compose
  local compose_args=()
  if [ -n "$compose_file" ] && [ -f "$ZAPMASS_ROOT/$compose_file" ]; then
    compose_args+=(-f "$compose_file")
  fi

  if [ -f "$ZAPMASS_ROOT/docker-compose.yml" ] || [ ${#compose_args[@]} -gt 0 ]; then
    (cd "$ZAPMASS_ROOT" && docker compose "${compose_args[@]}" up -d --no-deps "$container" 2>>"$LOG") || true
    sleep 15
    local r3
    r3="$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null || echo 'missing')"
    if [ "$r3" = "true" ]; then
      _log "OK  $container recuperado via compose up"
      docker update --restart=always "$container" >/dev/null 2>&1 || true
      return 0
    fi
  fi

  _log "ERRO $container não subiu após todas as tentativas — verificar: docker logs $container"
  return 1
}

# ─── Produção ────────────────────────────────────────────────────────────────
check_and_fix "zapmass-evolution-go" "8081" "" || true

# ─── Homolog (se existir) ────────────────────────────────────────────────────
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "zapmass-evolution-go-homolog"; then
  check_and_fix "zapmass-evolution-go-homolog" "8082" "docker-compose.homolog.yml" || true
fi
