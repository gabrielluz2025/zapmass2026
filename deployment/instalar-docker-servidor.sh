#!/usr/bin/env bash
# =============================================================================
# ZapMass — instalação Docker pelo terminal do servidor (Ubuntu/Debian)
#
# Uso (na pasta do projeto, ex.: /opt/zapmass-sender):
#   sudo bash deployment/instalar-docker-servidor.sh
#
# Com IP público fixo (se a detecção automática falhar):
#   sudo PUBLIC_IP=2.24.210.220 bash deployment/instalar-docker-servidor.sh
#
# Opcional — porta no host (padrão 3001):
#   sudo HOST_PORT=3001 bash deployment/instalar-docker-servidor.sh
# =============================================================================
set -euo pipefail

if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi

if [ "${EUID:-0}" -ne 0 ]; then
  echo "Execute com sudo"
  exec sudo -E bash "$0" "$@"
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

[ -f "$ROOT/package.json" ] || { echo "Erro: package.json não encontrado em $ROOT"; exit 1; }
[ -f "$ROOT/Dockerfile" ] || { echo "Erro: Dockerfile não encontrado. Envie o projeto completo ao servidor."; exit 1; }

echo "==> Pasta do projeto: $ROOT"

echo "==> Parando serviço systemd zapmass (se existir), para liberar a porta..."
systemctl stop zapmass 2>/dev/null || true
systemctl disable zapmass 2>/dev/null || true

echo "==> Instalando Docker (se necessário)..."
if ! command -v docker &>/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y ca-certificates curl
  apt-get install -y docker.io docker-compose-v2 || apt-get install -y docker.io docker-compose-plugin
  systemctl enable --now docker
fi

if ! docker info &>/dev/null; then
  echo "Docker não responde. Tente: systemctl start docker"
  exit 1
fi

# docker compose (plugin) vs docker-compose (binário antigo)
DC=(docker compose)
if ! docker compose version &>/dev/null; then
  if command -v docker-compose &>/dev/null; then
    DC=(docker-compose)
  else
    echo "Instale o plugin: apt-get install -y docker-compose-v2"
    exit 1
  fi
fi
echo "    Comando compose: ${DC[*]}"

echo "==> Arquivo .env..."
if [ ! -f "$ROOT/.env" ]; then
  if [ -f "$ROOT/docker.env.example" ]; then
    cp -a "$ROOT/docker.env.example" "$ROOT/.env"
    echo "    Copiado docker.env.example -> .env"
  fi
fi

IP="${PUBLIC_IP:-}"
if [ -z "$IP" ]; then
  IP="$(curl -fsS --connect-timeout 8 https://api.ipify.org 2>/dev/null || true)"
fi
if [ -z "$IP" ]; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
if [ -z "$IP" ]; then
  IP="127.0.0.1"
fi

HOST_PORT="${HOST_PORT:-3001}"

# Garante ALLOWED_ORIGINS coerente com IP e porta usados no browser
ALLOW="http://${IP}:${HOST_PORT}"
if [ -f "$ROOT/.env" ]; then
  if grep -q '^ALLOWED_ORIGINS=' "$ROOT/.env"; then
    sed -i.bak "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=${ALLOW}|" "$ROOT/.env"
  else
    echo "ALLOWED_ORIGINS=${ALLOW}" >> "$ROOT/.env"
  fi
  grep -q '^NODE_ENV=' "$ROOT/.env" || echo "NODE_ENV=production" >> "$ROOT/.env"
  grep -q '^PORT=' "$ROOT/.env" || echo "PORT=3001" >> "$ROOT/.env"
else
  {
    echo "NODE_ENV=production"
    echo "PORT=3001"
    echo "ALLOWED_ORIGINS=${ALLOW}"
  } > "$ROOT/.env"
fi
echo "    ALLOWED_ORIGINS=${ALLOW}"

export HOST_PORT

echo "==> Build e subida dos containers (pode levar vários minutos na primeira vez)..."
HOST_PORT="$HOST_PORT" "${DC[@]}" build
HOST_PORT="$HOST_PORT" "${DC[@]}" up -d

echo ""
echo "==> Status"
"${DC[@]}" ps

echo ""
echo "============================================================================="
echo " Pronto. Acesse no navegador a MESMA URL configurada em ALLOWED_ORIGINS:"
echo "   ${ALLOW}"
echo ""
echo " Comandos úteis:"
echo "   cd $ROOT && ${DC[*]} logs -f"
echo "   cd $ROOT && ${DC[*]} restart"
echo "   cd $ROOT && ${DC[*]} down"
echo " Libere a porta TCP ${HOST_PORT} no firewall da Hostinger (painel da VPS)."
echo "============================================================================="
