#!/usr/bin/env bash
# Correção imediata do Evolution Go em PRODUÇÃO e HOMOLOGAÇÃO.
# Corrige restart policy, sobe containers parados e instala watchdog.
#
# Uso: sudo bash deployment/fix-evolution-go-now.sh
set -euo pipefail

ZAPMASS_ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
cd "$ZAPMASS_ROOT" 2>/dev/null || true

echo "======================================================="
echo " ZapMass — Correção imediata do Evolution Go"
echo "======================================================="

fix_container() {
  local cname="$1"
  local port="$2"
  local compose_file="${3:-docker-compose.yml}"

  echo ""
  echo "--- Verificando: $cname (porta $port) ---"

  local exists
  exists="$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -x "$cname" || true)"

  if [ -z "$exists" ]; then
    echo "  Container $cname não existe — criando via compose..."
    docker compose -f "$compose_file" up -d --no-deps evolution-go 2>/dev/null || \
    docker compose up -d --no-deps evolution-go 2>/dev/null || \
    echo "  AVISO: não foi possível criar $cname — verifique o compose file"
    sleep 10
    exists="$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -x "$cname" || true)"
  fi

  if [ -z "$exists" ]; then
    echo "  ERRO: $cname não encontrado após tentativa de criação"
    return 1
  fi

  # Atualiza restart policy
  local old_policy
  old_policy="$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' "$cname" 2>/dev/null || echo '?')"
  docker update --restart=always "$cname" >/dev/null 2>&1 && echo "  restart=always aplicado (era: $old_policy)" || true

  # Verifica se está rodando
  local running
  running="$(docker inspect --format '{{.State.Running}}' "$cname" 2>/dev/null || echo 'missing')"

  if [ "$running" != "true" ]; then
    echo "  Container parado — iniciando..."
    docker start "$cname" 2>/dev/null || docker compose up -d --no-deps evolution-go 2>/dev/null || true
    sleep 8
    running="$(docker inspect --format '{{.State.Running}}' "$cname" 2>/dev/null || echo 'missing')"
  fi

  if [ "$running" = "true" ]; then
    echo "  Container RODANDO"
    # Probe HTTP
    local ok=0
    for _i in 1 2 3 4; do
      if curl -sf --max-time 5 "http://127.0.0.1:${port}/" >/dev/null 2>&1 || \
         wget -qO- --timeout=5 "http://127.0.0.1:${port}/" >/dev/null 2>&1; then
        ok=1
        break
      fi
      echo "  Aguardando porta $port ($(_i)s)..."
      sleep 5
    done
    if [ "$ok" = "1" ]; then
      echo "  OK: Evolution Go responde na porta $port"
    else
      echo "  AVISO: container subiu mas porta $port ainda não responde — pode estar inicializando"
      echo "  Verifique em 30s: docker logs $cname --tail=30"
    fi
  else
    echo "  ERRO: $cname não subiu. Logs:"
    docker logs "$cname" --tail=20 2>/dev/null || true
    return 1
  fi
}

# ─── Produção ────────────────────────────────────────────────────────────────
fix_container "zapmass-evolution-go" "8081" "docker-compose.yml" || true

# ─── Homologação ─────────────────────────────────────────────────────────────
if [ -f "$ZAPMASS_ROOT/docker-compose.homolog.yml" ]; then
  fix_container "zapmass-evolution-go-homolog" "8082" "docker-compose.homolog.yml" || true
fi

# ─── Instala watchdog ────────────────────────────────────────────────────────
echo ""
echo "--- Instalando watchdog (cron a cada 2 minutos) ---"
if [ -f "$ZAPMASS_ROOT/deployment/install-evolution-go-watchdog.sh" ]; then
  chmod +x "$ZAPMASS_ROOT/deployment/watchdog-evolution-go.sh" 2>/dev/null || true
  chmod +x "$ZAPMASS_ROOT/deployment/install-evolution-go-watchdog.sh" 2>/dev/null || true
  bash "$ZAPMASS_ROOT/deployment/install-evolution-go-watchdog.sh" 2>/dev/null && echo "  Watchdog instalado com sucesso" || echo "  AVISO: falha ao instalar watchdog"
else
  # Instala watchdog inline se o script não existir (VPS com versão antiga)
  cat > /etc/cron.d/zapmass-evolution-go-watchdog <<'CRON'
*/2 * * * * root bash /opt/zapmass/deployment/watchdog-evolution-go.sh >> /var/log/zapmass-evolution-go-watchdog.log 2>&1
CRON
  chmod 644 /etc/cron.d/zapmass-evolution-go-watchdog 2>/dev/null || true
  echo "  Watchdog instalado diretamente em /etc/cron.d/"
fi

echo ""
echo "======================================================="
echo " Status final"
echo "======================================================="
docker ps --filter "name=zapmass-evolution-go" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true

echo ""
echo "Pronto! O Evolution Go será reiniciado automaticamente pelo watchdog se cair."
echo "Logs do watchdog: tail -f /var/log/zapmass-evolution-go-watchdog.log"
