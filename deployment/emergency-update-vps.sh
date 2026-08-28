#!/usr/bin/env bash
# emergency-update-vps.sh
# =========================================================
# Força atualização VPS para origin/main SEM depender do .env
# e reinicia evolution-go (produção + homologação).
#
# Uso: cd /opt/zapmass && bash deployment/emergency-update-vps.sh
# =========================================================
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

ok()   { echo -e "\033[0;32m✓ $*\033[0m"; }
info() { echo -e "\033[0;36mℹ $*\033[0m"; }
err()  { echo -e "\033[0;31m✗ $*\033[0m"; }
step() { echo -e "\n\033[1;37m==> $*\033[0m"; }

# ─── 1. Corrige .env: envolve linha 29 problemática se tiver parênteses ──────
step "1/6 — Verificar .env (linha 29)"
if [[ -f .env ]]; then
  LINE29=$(sed -n '29p' .env)
  info "Linha 29 atual: $LINE29"
  # Se linha 29 não começa com # e tem parênteses sem aspas → envolve em aspas
  if [[ "$LINE29" =~ ^[^#].*\(.*\) ]] && ! [[ "$LINE29" =~ ^[^=]+=\".*\"$ ]]; then
    KEY="${LINE29%%=*}"
    VAL="${LINE29#*=}"
    if [[ "$VAL" != \"*\" ]] && [[ "$VAL" != \'*\' ]]; then
      sed -i "29s|.*|${KEY}=\"${VAL}\"|" .env
      info "Linha 29 corrigida: ${KEY}=\"${VAL}\""
    fi
  fi
  ok ".env verificado"
fi

# ─── 2. Força git para origin/main ───────────────────────────────────────────
step "2/6 — Alinhar código com origin/main"
git fetch origin +refs/heads/main:refs/remotes/origin/main
ORIGIN=$(git rev-parse refs/remotes/origin/main)
ORIGIN_SHORT=$(git rev-parse --short refs/remotes/origin/main)
ORIGIN_MSG=$(git log -1 --pretty=format:%s refs/remotes/origin/main | head -c 80)
info "origin/main: ${ORIGIN_SHORT} — ${ORIGIN_MSG}"

git checkout -f -B main "refs/remotes/origin/main"
git reset --hard "refs/remotes/origin/main"
COMMIT=$(git rev-parse --short HEAD)
ok "HEAD agora em ${COMMIT}"

# ─── 3. Reiniciar evolution-go (produção) ────────────────────────────────────
step "3/6 — Reiniciar evolution-go (produção)"
if docker ps -a --format '{{.Names}}' | grep -q '^zapmass-evolution-go$'; then
  docker compose -f docker-compose.yml restart evolution-go 2>&1 || true
  sleep 8
  EVO_STATUS=$(docker inspect --format='{{.State.Status}}' zapmass-evolution-go 2>/dev/null || echo 'missing')
  if [[ "$EVO_STATUS" == "running" ]]; then
    ok "zapmass-evolution-go: running"
  else
    err "zapmass-evolution-go status: $EVO_STATUS"
    info "Tentando subir..."
    docker compose -f docker-compose.yml up -d evolution-go 2>&1 || true
  fi
else
  info "Container zapmass-evolution-go não existe, subindo..."
  docker compose -f docker-compose.yml up -d evolution-go 2>&1 || true
fi

# ─── 4. Reiniciar evolution-go-homolog ───────────────────────────────────────
step "4/6 — Reiniciar evolution-go-homolog"
if docker ps -a --format '{{.Names}}' | grep -q '^zapmass-evolution-go-homolog$'; then
  docker compose -f docker-compose.homolog.yml restart evolution-go-homolog 2>&1 || true
  sleep 8
  H_STATUS=$(docker inspect --format='{{.State.Status}}' zapmass-evolution-go-homolog 2>/dev/null || echo 'missing')
  if [[ "$H_STATUS" == "running" ]]; then
    ok "zapmass-evolution-go-homolog: running"
  else
    err "zapmass-evolution-go-homolog status: $H_STATUS"
    docker compose -f docker-compose.homolog.yml up -d evolution-go-homolog 2>&1 || true
  fi
else
  info "Container zapmass-evolution-go-homolog não existe, subindo..."
  docker compose -f docker-compose.homolog.yml up -d evolution-go-homolog 2>&1 || true
fi

# ─── 5. Build e deploy principal ─────────────────────────────────────────────
step "5/6 — Build e deploy ZapMass (produção)"
export VITE_GIT_REF="${COMMIT}"
export GITHUB_EVENT_NAME=manual
unset GITHUB_ACTIONS 2>/dev/null || true
bash deployment/vps-deploy.sh

# ─── 6. Status final ─────────────────────────────────────────────────────────
step "6/6 — Status final"
echo ""
docker ps --filter "name=zapmass" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true
echo ""
ok "Atualização concluída — versão: ${COMMIT}"
info "Para checar licença Evolution Go:"
echo "  curl -H 'apikey: \$(grep EVOLUTION_GO_KEY .env | head -1 | cut -d= -f2)' http://127.0.0.1:8081/license/status"
echo "  curl -H 'apikey: \$(grep EVOLUTION_GO_KEY_HOMOLOG .env | head -1 | cut -d= -f2)' http://127.0.0.1:8082/license/status"
