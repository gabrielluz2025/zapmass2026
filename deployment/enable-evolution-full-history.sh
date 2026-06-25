#!/usr/bin/env bash
# Ativa syncFullHistory em todas as instâncias Evolution (histórico completo do WhatsApp).
# Uso: cd /opt/zapmass && bash deployment/enable-evolution-full-history.sh
# Opcional: RESTART_OPEN=1 bash deployment/enable-evolution-full-history.sh
set -eu

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

read_evolution_api_key() {
  local key cid
  cid="$(docker compose ps -q evolution 2>/dev/null | head -1 || true)"
  if [ -n "$cid" ]; then
    key="$(docker exec "$cid" printenv AUTHENTICATION_API_KEY 2>/dev/null || true)"
    [ -n "$key" ] && printf '%s' "$key" && return 0
  fi
  if [ -f .env ]; then
    key="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=' .env 2>/dev/null | tail -1 \
      | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=//' | tr -d '\r"' \
      | sed 's/^["'\'']//;s/["'\'']$//' || true)"
    [ -n "$key" ] && printf '%s' "$key" && return 0
  fi
  printf '%s' "${EVOLUTION_API_KEY:-zapmass-secure-key-2026}"
}

API_KEY="$(read_evolution_api_key)"
EVO_URL="${EVOLUTION_API_URL:-${EVOLUTION_SERVER_URL:-http://127.0.0.1:8080}}"
EVO_URL="${EVO_URL%/}"
RESTART_OPEN="${RESTART_OPEN:-0}"

echo "==> Evolution URL: ${EVO_URL}"
echo "==> API key prefix: ${API_KEY:0:8}..."

INST_JSON="$(curl -sS --max-time 20 "${EVO_URL}/instance/fetchInstances" -H "apikey: ${API_KEY}")"
if ! echo "$INST_JSON" | grep -q '"name"'; then
  echo "ERR: fetchInstances falhou (401/chave errada?). Resposta:"
  echo "$INST_JSON" | head -c 400
  echo ""
  exit 1
fi

export API_KEY EVO_URL RESTART_OPEN
echo "$INST_JSON" | python3 <<'PY'
import json, os, sys, urllib.parse, urllib.request

api_key = os.environ.get('API_KEY', '')
evo_url = os.environ.get('EVO_URL', '').rstrip('/')
restart_open = os.environ.get('RESTART_OPEN', '0') == '1'

SETTINGS_BODY = {
    'rejectCall': False,
    'msgCall': '',
    'groupsIgnore': False,
    'alwaysOnline': False,
    'readMessages': False,
    'readStatus': False,
    'syncFullHistory': True,
}

def req(method, path, body=None):
    url = f'{evo_url}{path}'
    data_b = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data_b, method=method)
    r.add_header('apikey', api_key)
    r.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(r, timeout=30) as resp:
        return resp.read().decode()

try:
    data = json.load(sys.stdin)
except Exception as e:
    print(f'JSON inválido: {e}')
    sys.exit(1)

rows = data if isinstance(data, list) else data.get('instances') or data.get('data') or []
if not rows:
    print('Nenhuma instância encontrada.')
    sys.exit(0)

for row in rows:
    name = row.get('name') or row.get('instanceName') or ''
    if not name:
        continue
    enc = urllib.parse.quote(name)
    status = str(row.get('connectionStatus') or row.get('state') or '').lower()
    setting = row.get('Setting') or row.get('setting') or {}
    before = setting.get('syncFullHistory')
    try:
        req('POST', f'/settings/set/{enc}', SETTINGS_BODY)
        print(f'OK  {name}  syncFullHistory: {before!r} -> true  status={status}')
        if restart_open and status == 'open':
            try:
                req('POST', f'/instance/restart/{enc}', {})
                print('    restart POST OK (histórico pode demorar minutos)')
            except Exception as e:
                print(f'    restart falhou: {e}')
    except Exception as e:
        print(f'ERR {name}: {e}')
PY

echo ""
echo "==> Concluído."
echo "    Instâncias open precisam de restart/reconexão para baixar histórico antigo."
echo "    Depois: bash deployment/diagnose-evolution-chat.sh"
