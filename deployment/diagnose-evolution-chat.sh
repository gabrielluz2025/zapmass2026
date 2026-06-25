#!/usr/bin/env bash
# Diagnóstico: Evolution API + ZapMass chat (findChats / findMessages / versão).
# Uso: cd /opt/zapmass && bash deployment/diagnose-evolution-chat.sh [connectionId]
set -eu

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

API_KEY="${EVOLUTION_API_KEY:-$(grep -E '^EVOLUTION_API_KEY=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d $'\r"\'')}"
API_KEY="${API_KEY:-zapmass-secure-key-2026}"
EVO_URL="${EVOLUTION_API_URL:-${EVOLUTION_SERVER_URL:-http://127.0.0.1:8080}}"
EVO_URL="${EVO_URL%/}"
HOST_PORT="${HOST_PORT:-$(grep -E '^HOST_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d $'\r"\'')}"
HOST_PORT="${HOST_PORT:-3001}"
CONN="${1:-}"

echo "==> ZapMass version"
curl -sf "http://127.0.0.1:${HOST_PORT}/api/version" 2>/dev/null || echo "(API indisponível)"
echo ""

echo "==> Env chat sync"
grep -E '^(WA_FULL_INBOX_SYNC|WA_CHAT_ARCHIVE|EVOLUTION_SYNC_|CHAT_SOCKET_MSG_TAIL|EVOLUTION_API_URL)=' .env 2>/dev/null \
  || echo "(variáveis não definidas — defaults do código)"
echo ""

echo "==> Evolution URL: ${EVO_URL}"
echo "==> Evolution instâncias (fetchInstances)"
INST_JSON="$(curl -sS --max-time 15 "${EVO_URL}/instance/fetchInstances" -H "apikey: ${API_KEY}" 2>&1)" || INST_JSON='{"error":"curl falhou"}'
echo "$INST_JSON" | head -c 3000
echo ""
echo ""

if [ -z "$CONN" ]; then
  CONN="$(echo "$INST_JSON" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
rows = data if isinstance(data, list) else data.get('instances') or data.get('data') or []
if not isinstance(rows, list):
    sys.exit(0)
open_rows = [r for r in rows if str(r.get('connectionStatus') or r.get('state') or '').lower() == 'open']
pick = open_rows[0] if open_rows else (rows[0] if rows else None)
if pick:
    print(pick.get('name') or pick.get('instanceName') or '')
" 2>/dev/null || true)"
fi

if [ -z "$CONN" ]; then
  echo "==> Nenhuma instância detectada no JSON."
  echo "    Passe manualmente: bash deployment/diagnose-evolution-chat.sh SEU_CONN_ID"
  echo "==> Fim."
  exit 0
fi

ENC="$(python3 -c "import urllib.parse; print(urllib.parse.quote('${CONN}'))" 2>/dev/null || printf '%s' "$CONN")"
echo "==> Instância teste: ${CONN}"
echo ""

echo "==> syncFullHistory (Setting da instância)"
echo "$INST_JSON" | python3 -c "
import json, sys
target = sys.argv[1] if len(sys.argv) > 1 else ''
try:
    data = json.load(sys.stdin)
except Exception as e:
    print(f'(parse falhou: {e})')
    sys.exit(0)
rows = data if isinstance(data, list) else data.get('instances') or data.get('data') or []
for r in rows:
    name = r.get('name') or r.get('instanceName') or ''
    if name == target:
        setting = r.get('Setting') or r.get('setting') or {}
        print('syncFullHistory:', setting.get('syncFullHistory'))
        print('connectionStatus:', r.get('connectionStatus') or r.get('state'))
        msgs = (r.get('_count') or {}).get('Message')
        chats = (r.get('_count') or {}).get('Chat')
        if msgs is not None:
            print('_count.Message:', msgs, '| Chat:', chats)
        break
else:
    print('(instância não encontrada no JSON)')
" "$CONN" 2>/dev/null || echo "(python indisponível)"
echo ""

echo "==> connectionState"
curl -sS --max-time 15 "${EVO_URL}/instance/connectionState/${ENC}" -H "apikey: ${API_KEY}" 2>&1 || echo "(falhou connectionState)"
echo ""
echo ""

echo "==> findChats (page 1, limit 5)"
CHATS="$(curl -sS --max-time 20 -X POST "${EVO_URL}/chat/findChats/${ENC}" \
  -H "apikey: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"page":1,"limit":5}' 2>&1)" || CHATS='{"error":"findChats falhou"}'
echo "$CHATS" | head -c 3000
echo ""
echo ""

echo "==> findMessages amostra (primeiro chat 1:1)"
REMOTE="$(echo "$CHATS" | sed -n 's/.*"remoteJid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | grep -v '@g.us' | head -1)"

if [ -n "$REMOTE" ]; then
  echo "remoteJid: ${REMOTE}"
  MSGS="$(curl -sS --max-time 20 -X POST "${EVO_URL}/chat/findMessages/${ENC}" \
    -H "apikey: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"where\":{\"key\":{\"remoteJid\":\"${REMOTE}\"}},\"page\":1,\"limit\":5}" 2>&1)" || MSGS='{"error":"findMessages falhou"}'
  echo "$MSGS" | head -c 3000
  echo ""
else
  echo "(nenhum chat 1:1 na amostra — findChats vazio ou só grupos)"
fi
echo ""
echo "==> Fim."
echo "    syncFullHistory=false impede histórico antigo no servidor Evolution."
echo "    Rode: bash deployment/enable-evolution-full-history.sh (e reconecte o chip se já estava open)."
