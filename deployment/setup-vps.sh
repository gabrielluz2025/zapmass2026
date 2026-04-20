#!/usr/bin/env bash
# Instala tudo no Ubuntu/Debian (um comando):
#   sudo bash deployment/setup-vps.sh
# (rode na RAIZ do projeto ou com o caminho completo do script.)
#
# Opcionais via ambiente:
#   PUBLIC_URL=http://2.24.210.220:3001     força ALLOWED_ORIGINS (várias: vírgula)
#   PORT=3001

set -euo pipefail

die() { echo "ERRO: $*" >&2; exit 1; }

if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

[ -f package.json ] || die "package.json não encontrado em $ROOT (rode dentro do clone do projeto)."

if [[ "$ROOT" =~ [[:space:]] ]]; then
  die "Use uma pasta sem espaços, ex.: mv para /opt/zapmass-sender e rode de lá."
fi

if [ "${EUID:-0}" -ne 0 ]; then
  echo "Pedindo sudo..."
  exec sudo -E bash "$0" "$@"
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Atualizando pacotes base..."
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git \
  fonts-liberation libappindicator3-1 libasound2 libatk-bridge2.0-0 libatk1.0-0 \
  libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 libx11-xcb1 \
  libxcomposite1 libxdamage1 libxrandr2 xdg-utils || true

echo "==> Node.js (>= 20)..."
NEED_NODE=0
if ! command -v node &>/dev/null; then
  NEED_NODE=1
else
  MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "${MAJOR:-0}" -lt 20 ] && NEED_NODE=1
fi

if [ "$NEED_NODE" -eq 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

command -v node &>/dev/null || die "Node não instalado."
node -v

echo "==> Chromium (Puppeteer / WhatsApp)..."
CH_PATH=""
if command -v chromium-browser &>/dev/null; then
  CH_PATH="$(command -v chromium-browser)"
elif command -v chromium &>/dev/null; then
  CH_PATH="$(command -v chromium)"
else
  apt-get install -y -qq chromium-browser 2>/dev/null || apt-get install -y -qq chromium || true
  if command -v chromium-browser &>/dev/null; then
    CH_PATH="$(command -v chromium-browser)"
  elif command -v chromium &>/dev/null; then
    CH_PATH="$(command -v chromium)"
  fi
fi

PORT="${PORT:-3001}"

if [ -n "${PUBLIC_URL:-}" ]; then
  ALLOWED_ORIGINS_VALUE="$PUBLIC_URL"
  if [ -n "${EXTRA_ALLOWED_ORIGINS:-}" ]; then
    ALLOWED_ORIGINS_VALUE="${ALLOWED_ORIGINS_VALUE},${EXTRA_ALLOWED_ORIGINS}"
  fi
else
  PUB_IP="$(curl -fsS --connect-timeout 6 https://api.ipify.org 2>/dev/null || true)"
  if [ -z "$PUB_IP" ]; then
    PUB_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  [ -n "$PUB_IP" ] || die "Não consegui detectar IP. Defina: PUBLIC_URL=http://SEU_IP:${PORT} sudo -E bash $0"
  ALLOWED_ORIGINS_VALUE="http://${PUB_IP}:${PORT}"

  # Se também existir hostname público (Hostinger), permite ler do ambiente
  if [ -n "${EXTRA_ALLOWED_ORIGINS:-}" ]; then
    ALLOWED_ORIGINS_VALUE="${ALLOWED_ORIGINS_VALUE},${EXTRA_ALLOWED_ORIGINS}"
  fi
fi

echo "==> .env (ALLOWED_ORIGINS=${ALLOWED_ORIGINS_VALUE})"
if [ -f .env ] && [ "${SETUP_KEEP_ENV:-}" = "1" ]; then
  echo "    Mantendo .env existente (SETUP_KEEP_ENV=1)."
else
  if [ -f .env ]; then
    cp -a .env ".env.bak.$(date +%Y%m%d%H%M%S)"
  fi
  {
    echo "NODE_ENV=production"
    echo "PORT=${PORT}"
    echo "ALLOWED_ORIGINS=${ALLOWED_ORIGINS_VALUE}"
    if [ -n "$CH_PATH" ]; then
      echo "PUPPETEER_EXECUTABLE_PATH=${CH_PATH}"
    fi
  } > .env
  echo "    Escrito $ROOT/.env"
fi

echo "==> npm install + build..."
export NODE_ENV=development
npm install
npm run build
export NODE_ENV=production

UNIT="/etc/systemd/system/zapmass.service"
echo "==> systemd -> $UNIT"

cat > "$UNIT" <<EOF
[Unit]
Description=ZapMass Sender (Node + Express + UI)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${ROOT}
Environment=NODE_ENV=production
EnvironmentFile=-${ROOT}/.env
ExecStart=${ROOT}/node_modules/.bin/tsx server/server.ts
Restart=on-failure
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable zapmass
systemctl restart zapmass

sleep 2
if curl -fsS "http://127.0.0.1:${PORT}/api/health" | head -c 300; then
  echo ""
  echo "OK: API respondeu em http://127.0.0.1:${PORT}/api/health"
else
  echo "Aviso: health check falhou. Logs: journalctl -u zapmass -n 80 --no-pager"
fi

echo ""
echo "==> Pronto."
echo "    Abra no navegador (use o MESMO host da ALLOWED_ORIGINS):"
echo "    http://SEU_IP:${PORT}/"
echo "    Libere a porta ${PORT} no firewall da Hostinger (e UFW, se usar: ufw allow ${PORT}/tcp)."
echo "    Logs: journalctl -u zapmass -f"
