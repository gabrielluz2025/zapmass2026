#!/usr/bin/env bash
# Atualiza MERCADOPAGO_ACCESS_TOKEN no .env da VPS, sincroniza secrets/ e reinicia a API.
# Uso: MERCADOPAGO_ACCESS_TOKEN=APP_USR-... bash deployment/set-mercadopago-token.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TOKEN="${MERCADOPAGO_ACCESS_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  echo "ERRO: defina MERCADOPAGO_ACCESS_TOKEN (Access Token de producao APP_USR-…)."
  exit 1
fi

# Remove aspas / Bearer acidentais
TOKEN="${TOKEN#\"}"
TOKEN="${TOKEN%\"}"
TOKEN="${TOKEN#\'}"
TOKEN="${TOKEN%\'}"
TOKEN="${TOKEN#Bearer }"
TOKEN="${TOKEN//$'\r'/}"
TOKEN="${TOKEN//$'\n'/}"

if [[ ! "$TOKEN" =~ ^APP_USR- ]] && [[ ! "$TOKEN" =~ ^TEST- ]]; then
  echo "ERRO: token deve comecar com APP_USR- (producao) ou TEST- (sandbox)."
  exit 1
fi

ENV_FILE="${ROOT}/.env"
touch "$ENV_FILE"

python3 - "$ENV_FILE" "$TOKEN" <<'PY'
import re, sys
from pathlib import Path
path = Path(sys.argv[1])
token = sys.argv[2]
text = path.read_text(encoding="utf-8") if path.exists() else ""
lines = text.splitlines()
key = "MERCADOPAGO_ACCESS_TOKEN"
new_line = f"{key}={token}"
out = []
replaced = False
for line in lines:
    if re.match(rf"^\s*(?:export\s+)?{re.escape(key)}=", line):
        out.append(new_line)
        replaced = True
    else:
        out.append(line)
if not replaced:
    out.append(new_line)
back_key = "MERCADOPAGO_BACK_URL"
back_val = "https://zap-mass.com"
back_line = f"{back_key}={back_val}"
back_replaced = False
final = []
for line in out:
    if re.match(rf"^\s*(?:export\s+)?{re.escape(back_key)}=", line):
        final.append(back_line)
        back_replaced = True
    else:
        final.append(line)
if not back_replaced:
    final.append(back_line)
path.write_text("\n".join(final).rstrip() + "\n", encoding="utf-8")
PY

mkdir -p secrets
printf '%s\n' "$TOKEN" > secrets/mercadopago_access_token
chmod 600 secrets/mercadopago_access_token

echo "==> .env e secrets/mercadopago_access_token atualizados (prefixo ${TOKEN:0:14}…; len=${#TOKEN})"

export MERCADOPAGO_ACCESS_TOKEN="$TOKEN"
if [ -f deployment/verify-mercadopago-token.sh ]; then
  bash deployment/verify-mercadopago-token.sh
fi

if docker info >/dev/null 2>&1 && docker service ls --format '{{.Name}}' 2>/dev/null | grep -qx zapmass_api; then
  echo "==> Reiniciando zapmass_api para carregar o token novo…"
  docker service update --force zapmass_api
  echo "==> Aguardando API…"
  for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:3001/api/health" 2>/dev/null | grep -q '"mercadopagoCheckoutAvailable":true'; then
      echo "==> OK: checkout Mercado Pago disponivel."
      exit 0
    fi
    sleep 5
  done
  echo "AVISO: API subiu mas mercadopagoCheckoutAvailable ainda nao e true — confira o token no painel MP."
  curl -fsS "http://127.0.0.1:3001/api/health" 2>/dev/null || true
  exit 1
fi

echo "==> Swarm nao detectado; rode: bash deployment/vps-deploy.sh"
exit 0
