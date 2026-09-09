#!/usr/bin/env bash
# Ativa histórico completo do WhatsApp (Evolution API ou Evolution Go).
# Uso: cd /opt/zapmass && bash deployment/enable-evolution-full-history.sh
# Go + reconnect chips conectados: RESTART_OPEN=1 bash deployment/enable-evolution-full-history.sh
set -eu

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

detect_whatsapp_engine() {
  local engine
  engine="$(grep -E '^[[:space:]]*(export[[:space:]]+)?ZAPMASS_WHATSAPP_ENGINE=' .env 2>/dev/null | tail -1 \
    | sed -E 's/^[[:space:]]*(export[[:space:]]+)?ZAPMASS_WHATSAPP_ENGINE=//' | tr -d '\r"' \
    | sed 's/^["'\'']//;s/["'\'']$//' || true)"
  engine="${engine:-${ZAPMASS_WHATSAPP_ENGINE:-evolution-go}}"
  printf '%s' "$(echo "$engine" | tr '[:upper:]' '[:lower:]')"
}

is_evolution_go_engine() {
  case "$(detect_whatsapp_engine)" in
    evolution-go | go | evogo) return 0 ;;
    *) return 1 ;;
  esac
}

read_evolution_api_key() {
  local key cid
  if is_evolution_go_engine; then
    if [ -f .env ]; then
      key="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_GO_KEY=' .env 2>/dev/null | tail -1 \
        | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_GO_KEY=//' | tr -d '\r"' \
        | sed 's/^["'\'']//;s/["'\'']$//' || true)"
      [ -n "$key" ] && printf '%s' "$key" && return 0
      key="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=' .env 2>/dev/null | tail -1 \
        | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=//' | tr -d '\r"' \
        | sed 's/^["'\'']//;s/["'\'']$//' || true)"
      [ -n "$key" ] && printf '%s' "$key" && return 0
    fi
    cid="$(docker compose ps -q evolution-go 2>/dev/null | head -1 || true)"
    if [ -n "$cid" ]; then
      key="$(docker exec "$cid" printenv GLOBAL_API_KEY 2>/dev/null | tr -d '\r' || true)"
      [ -n "$key" ] && printf '%s' "$key" && return 0
    fi
    printf '%s' "${EVOLUTION_GO_KEY:-${EVOLUTION_API_KEY:-zapmass-secure-key-2026}}"
    return 0
  fi

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

default_evo_url() {
  if is_evolution_go_engine; then
    printf '%s' "http://127.0.0.1:8081"
  else
    printf '%s' "http://127.0.0.1:8080"
  fi
}

API_KEY="$(read_evolution_api_key)"
EVO_URL="${EVOLUTION_API_URL:-${EVOLUTION_SERVER_URL:-$(default_evo_url)}}"
EVO_URL="${EVO_URL%/}"
RESTART_OPEN="${RESTART_OPEN:-0}"
ENGINE="$(detect_whatsapp_engine)"
IS_GO=0
is_evolution_go_engine && IS_GO=1

echo "==> Motor: ${ENGINE}"
echo "==> Evolution URL: ${EVO_URL}"
echo "==> API key prefix: ${API_KEY:0:8}..."

if [ "$IS_GO" = "1" ]; then
  INST_PATH="/instance/all"
else
  INST_PATH="/instance/fetchInstances"
fi

INST_JSON="$(curl -sS --max-time 20 "${EVO_URL}${INST_PATH}" -H "apikey: ${API_KEY}")"
if ! echo "$INST_JSON" | grep -q '"name"'; then
  echo "ERR: ${INST_PATH} falhou (401/chave errada ou serviço off?). Resposta:"
  echo "$INST_JSON" | head -c 400
  echo ""
  exit 1
fi

INST_TMP="$(mktemp /tmp/zapmass-evo-instances.XXXXXX.json)"
printf '%s' "$INST_JSON" > "$INST_TMP"
export API_KEY EVO_URL RESTART_OPEN IS_GO
python3 - "$INST_TMP" <<'PY'
import json, os, sys, urllib.parse, urllib.request

inst_path = sys.argv[1]
api_key = os.environ.get('API_KEY', '')
evo_url = os.environ.get('EVO_URL', '').rstrip('/')
restart_open = os.environ.get('RESTART_OPEN', '0') == '1'
is_go = os.environ.get('IS_GO', '0') == '1'

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

def is_open(row):
    if row.get('connected') is True:
        return True
    status = str(row.get('connectionStatus') or row.get('state') or '').lower()
    return status == 'open'

def go_history_sync(name: str) -> None:
    enc = urllib.parse.quote(name)
    # Go não expõe /instance/restart — HistorySync via connect + forceReconnect.
    req('POST', f'/instance/connect/{enc}', {'forceReconnect': True})

with open(inst_path, encoding='utf-8') as f:
    data = json.load(f)

rows = data if isinstance(data, list) else data.get('instances') or data.get('data') or []
if not rows:
    print('Nenhuma instância encontrada.')
    sys.exit(0)

seen = set()
open_names = []
for row in rows:
    name = row.get('name') or row.get('instanceName') or ''
    if not name or name in seen:
        continue
    seen.add(name)
    enc = urllib.parse.quote(name)
    status = str(row.get('connectionStatus') or row.get('state') or ('open' if row.get('connected') else 'close')).lower()
    setting = row.get('Setting') or row.get('setting') or {}
    before = setting.get('syncFullHistory')
    open_now = is_open(row)
    if open_now:
        open_names.append(name)

    if is_go:
        print(f'  {name}  connected={open_now}  webhook={"sim" if row.get("webhook") else "nao"}')
        if restart_open and open_now:
            try:
                go_history_sync(name)
                print('    connect forceReconnect OK (HistorySync pode demorar minutos)')
            except Exception as e:
                print(f'    HistorySync falhou: {e}')
        continue

    try:
        req('POST', f'/settings/set/{enc}', SETTINGS_BODY)
        print(f'OK  {name}  syncFullHistory: {before!r} -> true  status={status}')
        if restart_open and open_now:
            try:
                req('POST', f'/instance/restart/{enc}', {})
                print('    restart POST OK (histórico pode demorar minutos)')
            except Exception as e:
                print(f'    restart falhou: {e}')
    except Exception as e:
        print(f'ERR {name}: {e}')

if is_go and not open_names:
    print('')
    print('AVISO: nenhum chip CONNECTED no Go — HistorySync só funciona com chip online.')
    print('       Pareie QR em Conexões e rode de novo com RESTART_OPEN=1.')
PY
rm -f "$INST_TMP"

echo ""
echo "==> Concluído."
if [ "$IS_GO" = "1" ]; then
  echo "    Go: histórico vem via HistorySync após forceReconnect (botão Sincronizar do celular no Bate-papo)."
else
  echo "    Instâncias open precisam de restart/reconexão para baixar histórico antigo."
fi
echo "    Depois: bash deployment/check-evolution-go-health.sh"
