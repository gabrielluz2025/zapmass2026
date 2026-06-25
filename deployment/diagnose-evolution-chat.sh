#!/usr/bin/env bash
# Diagnóstico rápido: Evolution API + ZapMass chat (findChats / findMessages / versão).
# Uso na VPS: cd /opt/zapmass && bash deployment/diagnose-evolution-chat.sh [connectionId]
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

API_KEY="${EVOLUTION_API_KEY:-$(grep -E '^EVOLUTION_API_KEY=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d $'\r"\'')}"
API_KEY="${API_KEY:-zapmass-secure-key-2026}"
EVO_URL="${EVOLUTION_SERVER_URL:-http://127.0.0.1:8080}"
EVO_URL="${EVO_URL%/}"
HOST_PORT="${HOST_PORT:-$(grep -E '^HOST_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d $'\r"\'')}"
HOST_PORT="${HOST_PORT:-3001}"
CONN="${1:-}"

echo "==> ZapMass version"
curl -sf "http://127.0.0.1:${HOST_PORT}/api/version" 2>/dev/null || echo "(API indisponível)"
echo ""

echo "==> Env chat sync"
grep -E '^(WA_FULL_INBOX_SYNC|WA_CHAT_ARCHIVE|EVOLUTION_SYNC_|CHAT_SOCKET_MSG_TAIL)=' .env 2>/dev/null || echo "(variáveis não definidas — defaults do código)"
echo ""

echo "==> Evolution instâncias"
INST_JSON=$(curl -sf "${EVO_URL}/instance/fetchInstances" -H "apikey: ${API_KEY}" 2>/dev/null || echo '[]')
echo "$INST_JSON" | head -c 2000
echo ""
echo ""

if [ -z "$CONN" ]; then
  CONN=$(echo "$INST_JSON" | sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
fi

if [ -z "$CONN" ]; then
  echo "==> Nenhuma instância encontrada. Passe o connectionId: bash deployment/diagnose-evolution-chat.sh conn_xxx"
  exit 0
fi

ENC=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${CONN}'))" 2>/dev/null || echo "$CONN")
echo "==> Instância teste: ${CONN}"
echo ""

echo "==> connectionState"
curl -sf "${EVO_URL}/instance/connectionState/${ENC}" -H "apikey: ${API_KEY}" || echo "(falhou)"
echo ""
echo ""

echo "==> findChats (page 1, limit 5)"
curl -sf -X POST "${EVO_URL}/chat/findChats/${ENC}" \
  -H "apikey: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"page":1,"limit":5}' | head -c 2500
echo ""
echo ""

echo "==> findMessages amostra (primeiro chat 1:1)"
REMOTE=$(curl -sf -X POST "${EVO_URL}/chat/findChats/${ENC}" \
  -H "apikey: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"page":1,"limit":10}' \
  | sed -n 's/.*"remoteJid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | grep -v '@g.us' | head -1)

if [ -n "$REMOTE" ]; then
  echo "remoteJid: ${REMOTE}"
  curl -sf -X POST "${EVO_URL}/chat/findMessages/${ENC}" \
    -H "apikey: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"where\":{\"key\":{\"remoteJid\":\"${REMOTE}\"}},\"page\":1,\"limit\":5}" | head -c 2500
  echo ""
else
  echo "(nenhum chat 1:1 na amostra)"
fi
echo ""
echo "==> Fim. Se findChats/findMessages vazios com state=open, a Evolution não indexou histórico desta sessão."
