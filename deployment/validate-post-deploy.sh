#!/usr/bin/env bash
# =============================================================================
# Validação pós-deploy — chips, histórico Evolution, inbox ZapMass
# =============================================================================
#
# Uso na VPS:
#   cd /opt/zapmass && bash deployment/validate-post-deploy.sh
#
# Uma instância específica (findChats/findMessages detalhado):
#   bash deployment/validate-post-deploy.sh conn_abc123
#
# Após upgrade Evolution ou deploy-completo:
#   1. Rode este script
#   2. No app: Bate-papo → ↻ Sincronizar agora + Ctrl+Shift+R
#   3. Se syncFullHistory=false em chip open: enable-evolution-full-history.sh + reconectar QR
# =============================================================================
set -eu

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

_evo_cid="$(docker compose ps -q evolution 2>/dev/null | head -1 || true)"
if [ -z "$_evo_cid" ]; then
  _evo_cid="$(docker ps -q --filter 'name=zapmass-evolution' 2>/dev/null | head -1 || true)"
fi
_key_env="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=' .env 2>/dev/null | tail -1 | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=//' | tr -d '\r"' | sed 's/^["'\'']//;s/["'\'']$//' || true)"
_key_container=""
if [ -n "$_evo_cid" ]; then
  _key_container="$(docker exec "$_evo_cid" printenv AUTHENTICATION_API_KEY 2>/dev/null || true)"
fi
# Container manda: .env desatualizado quebra fetchInstances enquanto GET / responde sem auth.
if [ -n "${EVOLUTION_API_KEY:-}" ]; then
  API_KEY="${EVOLUTION_API_KEY}"
elif [ -n "$_key_container" ]; then
  API_KEY="$_key_container"
else
  API_KEY="${_key_env:-zapmass-secure-key-2026}"
fi
KEY_ENV_MISMATCH=0
if [ -n "$_key_env" ] && [ -n "$_key_container" ] && [ "$_key_env" != "$_key_container" ]; then
  KEY_ENV_MISMATCH=1
fi
unset _key_env _key_container
EVO_URL="${EVOLUTION_API_URL:-${EVOLUTION_SERVER_URL:-http://127.0.0.1:8080}}"
EVO_URL="${EVO_URL%/}"
HOST_PORT="${HOST_PORT:-$(grep -E '^HOST_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d $'\r"\'')}"
HOST_PORT="${HOST_PORT:-3001}"
DETAIL_CONN="${1:-}"

pass=0
warn=0
fail=0

ok()   { echo "  ✅ $*"; pass=$((pass + 1)); }
warn() { echo "  ⚠️  $*"; warn=$((warn + 1)); }
bad()  { echo "  ❌ $*"; fail=$((fail + 1)); }

section() { echo ""; echo "==> $*"; echo ""; }

section "1/5 — ZapMass (API + commit local)"
HEALTH="$(curl -sf --max-time 10 "http://127.0.0.1:${HOST_PORT}/api/health" 2>/dev/null || echo '')"
if [ -n "$HEALTH" ]; then
  LIVE_VER="$(echo "$HEALTH" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  GIT_VER="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
  ok "API health OK (porta ${HOST_PORT}, versão live ${LIVE_VER:-?})"
  if [ -n "${LIVE_VER:-}" ] && [ "$LIVE_VER" = "$GIT_VER" ]; then
    ok "Código alinhado: git ${GIT_VER} = produção"
  elif [ -n "${LIVE_VER:-}" ]; then
    warn "Git ${GIT_VER} ≠ produção ${LIVE_VER} — rode deploy-completo.sh"
  fi
else
  bad "API indisponível em http://127.0.0.1:${HOST_PORT}/api/health"
fi

section "2/5 — Evolution API (versão + imagem Docker)"
EVO_INFO=""
for _evo_try in 1 2 3; do
  EVO_INFO="$(curl -sf --max-time 15 "${EVO_URL}/" 2>/dev/null || echo '')"
  if [ -n "$EVO_INFO" ]; then
    break
  fi
  [ "$_evo_try" -lt 3 ] && sleep 5
done
unset _evo_try
if [ -n "$EVO_INFO" ]; then
  EVO_VER="$(echo "$EVO_INFO" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  ok "Evolution responde (${EVO_URL}) — versão ${EVO_VER:-?}"
else
  bad "Evolution não responde em ${EVO_URL}"
  if docker service inspect zapmass_evolution >/dev/null 2>&1; then
    ev_rep="$(docker service ls --filter name=zapmass_evolution --format '{{.Replicas}}' 2>/dev/null || echo '?')"
    pg_rep="$(docker service ls --filter name=zapmass_postgres --format '{{.Replicas}}' 2>/dev/null || echo '?')"
    echo "  Swarm: evolution=${ev_rep} postgres=${pg_rep}"
    docker service ps zapmass_evolution --no-trunc 2>/dev/null | head -4 | sed 's/^/    /' || true
  elif [ -f docker-compose.yml ]; then
    echo "  Compose (sem stack Swarm):"
    docker compose ps evolution postgres redis 2>/dev/null | sed 's/^/    /' || true
    echo "  → bash deployment/fix-evolution-now.sh"
  fi
  echo "  → bash deployment/recover-postgres-evolution.sh"
fi
EVO_IMG="$(grep -E '^EVOLUTION_IMAGE=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d $'\r"' || true)"
if [ -n "$EVO_IMG" ]; then
  ok "EVOLUTION_IMAGE no .env: ${EVO_IMG}"
else
  warn "EVOLUTION_IMAGE não definido no .env"
fi

section "3/5 — Variáveis de sync (inbox / chat)"
for var in WA_FULL_INBOX_SYNC EVOLUTION_SYNC_MESSAGES CHAT_SOCKET_MSG_TAIL; do
  val="$(grep -E "^${var}=" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d $'\r"' || true)"
  if [ -n "$val" ]; then
    echo "  ${var}=${val}"
  else
    echo "  ${var}=(default do código)"
  fi
done

section "4/5 — Chips (status, syncFullHistory, mensagens no Postgres Evolution)"
if [ "$KEY_ENV_MISMATCH" = "1" ]; then
  warn "EVOLUTION_API_KEY no .env ≠ AUTHENTICATION_API_KEY do container — usando key do container"
  echo "  → alinhe .env e recrie: docker compose up -d --force-recreate evolution zapmass"
fi

INST_JSON=""
INST_HTTP="000"
for _fi_try in 1 2 3 4 5 6; do
  INST_HTTP="$(curl -sS --max-time 20 -o /tmp/zapmass-fetch-instances.json -w '%{http_code}' \
    "${EVO_URL}/instance/fetchInstances" -H "apikey: ${API_KEY}" 2>/dev/null || echo 000)"
  INST_JSON="$(cat /tmp/zapmass-fetch-instances.json 2>/dev/null || echo '')"
  if [ "$INST_HTTP" = "200" ] && [ -n "$INST_JSON" ]; then
    break
  fi
  [ "$_fi_try" -lt 6 ] && sleep 5
done
unset _fi_try

if [ "$INST_HTTP" != "200" ] || [ -z "$INST_JSON" ]; then
  bad "fetchInstances falhou (HTTP ${INST_HTTP})"
  if [ "$INST_HTTP" = "401" ] || [ "$INST_HTTP" = "403" ]; then
    echo "  API key rejeitada — confira EVOLUTION_API_KEY no .env vs container evolution"
    echo "  Container: docker exec \$(_evo_cid) printenv AUTHENTICATION_API_KEY"
  elif [ "$INST_HTTP" = "000" ]; then
    echo "  Evolution ainda subindo após deploy — aguarde 30s e rode de novo"
  fi
  echo "  Resposta: $(echo "$INST_JSON" | head -c 280)"
elif ! echo "$INST_JSON" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  bad "fetchInstances retornou JSON inválido"
  echo "  Resposta: $(echo "$INST_JSON" | head -c 280)"
else
  python3 - "$INST_JSON" <<'PY'
import json, sys

raw = sys.argv[1]
try:
    data = json.loads(raw)
except Exception as e:
    print(f"  ❌ JSON inválido: {e}")
    sys.exit(0)

rows = data if isinstance(data, list) else data.get("instances") or data.get("data") or []
if not isinstance(rows, list) or not rows:
    print("  ❌ Nenhuma instância Evolution encontrada")
    sys.exit(0)

print(f"  {'INSTÂNCIA':<28} {'STATUS':<8} {'syncFull':<8} {'Msgs':>8} {'Chats':>6}")
print(f"  {'-'*28} {'-'*8} {'-'*8} {'-'*8} {'-'*6}")

open_count = 0
open_no_full = []
open_no_msgs = []

for r in rows:
    name = (r.get("name") or r.get("instanceName") or "?")[:28]
    status = str(r.get("connectionStatus") or r.get("state") or "?").lower()
    setting = r.get("Setting") or r.get("setting") or {}
    full = setting.get("syncFullHistory")
    full_s = "true" if full is True else ("false" if full is False else str(full or "?"))
    counts = r.get("_count") or {}
    msgs = counts.get("Message")
    chats = counts.get("Chat")
    msgs_s = str(msgs) if msgs is not None else "?"
    chats_s = str(chats) if chats is not None else "?"

    flag = ""
    if status == "open":
        open_count += 1
        if full is not True:
            open_no_full.append(name.strip())
        if msgs == 0:
            open_no_msgs.append(name.strip())

    print(f"  {name:<28} {status:<8} {full_s:<8} {msgs_s:>8} {chats_s:>6}{flag}")

print("")
if open_count == 0:
    print("  ❌ Nenhum chip OPEN — reconecte QR em Conexões")
elif open_no_full:
    print("  ⚠️  OPEN sem syncFullHistory=true:", ", ".join(open_no_full))
    print("     → bash deployment/enable-evolution-full-history.sh && reconectar chip")
elif open_no_msgs:
    print("  ⚠️  OPEN com 0 mensagens no Postgres:", ", ".join(open_no_msgs))
    print("     → aguarde sync ou reconecte QR após enable-evolution-full-history.sh")
else:
    print(f"  ✅ {open_count} chip(s) OPEN com syncFullHistory e mensagens no servidor")
PY
fi

section "5/5 — Teste findChats (chips online)"
if [ -n "$INST_JSON" ] && ! echo "$INST_JSON" | grep -qiE 'error|unauthorized'; then
  python3 - "$INST_JSON" "$EVO_URL" "$API_KEY" "$DETAIL_CONN" <<'PY'
import json, sys, urllib.parse, urllib.request

data = json.loads(sys.argv[1])
evo_url = sys.argv[2].rstrip("/")
api_key = sys.argv[3]
detail = sys.argv[4] if len(sys.argv) > 4 else ""

rows = data if isinstance(data, list) else data.get("instances") or data.get("data") or []
open_rows = [r for r in rows if str(r.get("connectionStatus") or r.get("state") or "").lower() == "open"]

if detail:
    open_rows = [r for r in rows if (r.get("name") or r.get("instanceName") or "") == detail] or open_rows[:1]
elif not open_rows:
    open_rows = rows[:1]

if not open_rows:
    print("  ❌ Nenhuma instância para testar findChats")
    sys.exit(0)

def post(path, body):
    req = urllib.request.Request(
        f"{evo_url}{path}",
        data=json.dumps(body).encode(),
        headers={"apikey": api_key, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode())

for r in open_rows[:6]:
    name = r.get("name") or r.get("instanceName") or "?"
    enc = urllib.parse.quote(name, safe="")
    try:
        chats = post(f"/chat/findChats/{enc}", {"page": 1, "limit": 5})
        if isinstance(chats, dict):
            items = chats.get("chats") or chats.get("data") or chats.get("records") or []
        elif isinstance(chats, list):
            items = chats
        else:
            items = []
        n = len(items)
        if n > 0:
            print(f"  ✅ {name}: findChats retornou {n} conversa(s) (amostra)")
            # primeiro 1:1
            remote = None
            for c in items:
                jid = (c.get("remoteJid") or c.get("id") or "") if isinstance(c, dict) else ""
                if jid and "@g.us" not in jid:
                    remote = jid
                    break
            if remote:
                try:
                    msgs = post(f"/chat/findMessages/{enc}", {
                        "where": {"key": {"remoteJid": remote}},
                        "page": 1,
                        "limit": 3,
                    })
                    if isinstance(msgs, dict):
                        mitems = msgs.get("messages") or msgs.get("data") or msgs.get("records") or []
                    elif isinstance(msgs, list):
                        mitems = msgs
                    else:
                        mitems = []
                    print(f"     findMessages ({remote[:24]}…): {len(mitems)} msg(s) na amostra")
                except Exception as e:
                    print(f"     ⚠️  findMessages falhou: {e}")
        else:
            print(f"  ⚠️  {name}: findChats vazio — inbox pode ficar vazia até sync/reconexão")
    except Exception as e:
        print(f"  ❌ {name}: findChats erro — {e}")
PY
fi

section "Checklist manual (app)"
echo "  □ Abrir Bate-papo → chips online visíveis no seletor"
echo "  □ Clicar ↻ Sincronizar agora — lista de conversas aparece em ~5–30s"
echo "  □ Abrir uma conversa — mensagens antigas carregam (scroll para cima)"
echo "  □ Fotos de perfil nas linhas da inbox (após alguns segundos)"
echo "  □ Ctrl+Shift+R no navegador se cache antigo"

section "Resumo automático"
echo "  Passou: ${pass}  |  Avisos: ${warn}  |  Falhas: ${fail}"
if [ "$fail" -gt 0 ]; then
  echo ""
  echo "  Ação sugerida (ordem):"
  if docker service inspect zapmass_evolution >/dev/null 2>&1; then
    echo "    1. bash deployment/recover-postgres-evolution.sh   # Swarm: Evolution + Postgres"
  else
    echo "    1. bash deployment/fix-evolution-now.sh              # Compose: subir Evolution"
    echo "       ou: bash deployment/recover-postgres-evolution.sh"
  fi
  echo "    2. bash deployment/deploy-completo.sh                # alinhar ZapMass ao git"
  echo "    3. bash deployment/validate-post-deploy.sh           # rodar de novo"
  echo ""
  echo "  Diagnóstico detalhado: bash deployment/diagnose-evolution-chat.sh [conn_id]"
  exit 1
fi
if [ "$warn" -gt 0 ]; then
  echo ""
  echo "  Deploy parcialmente OK — revise avisos (syncFullHistory / findChats vazio)."
  exit 0
fi
echo ""
echo "  ✅ Validação automática OK. Confirme o checklist manual no navegador."
exit 0
