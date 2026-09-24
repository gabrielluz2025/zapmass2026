#!/usr/bin/env bash
# Inspeciona / purga jobs BullMQ campaign-messages via API internal (processo zapmass).
# HTTP via `docker compose exec` + Node fetch (PORT do processo; stderr não polui o JSON).
#
# IDs reais são UUID (ex.: 91bd39d7-5ae8-4df1-99b2-fb34396134c2) — não use "<campaignId>" na shell.
#
# Uso na VPS:
#   bash deployment/campaign-queue-vps.sh summary
#   bash deployment/campaign-queue-vps.sh summary --full
#   bash deployment/campaign-queue-vps.sh summary --campaign 91bd39d7-5ae8-4df1-99b2-fb34396134c2
#   bash deployment/campaign-queue-vps.sh dry-run 91bd39d7-5ae8-4df1-99b2-fb34396134c2
#   bash deployment/campaign-queue-vps.sh purge 91bd39d7-5ae8-4df1-99b2-fb34396134c2
#   ZAPMASS_PURGE_CONFIRM='PURGE <uuid>' bash deployment/campaign-queue-vps.sh purge <uuid>
#   bash deployment/campaign-queue-vps.sh diag
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-.env}"

json_pretty() {
  local input
  input="$(cat)"
  if [ -z "${input//[[:space:]]/}" ]; then
    echo "ERRO: resposta vazia da API (veja mensagens acima)." >&2
    echo "  Teste: bash deployment/campaign-queue-vps.sh diag" >&2
    exit 1
  fi
  if ! printf '%s' "$input" | python3 -m json.tool 2>/dev/null; then
    echo "ERRO: corpo não é JSON válido:" >&2
    printf '%s\n' "$input" | head -c 1200 >&2
    echo >&2
    exit 1
  fi
}

# Node one-shot dentro do container (loopback + mesmo PORT que a API)
api_json() {
  local method="${1:-GET}"
  local path="$2"
  local body="${3:-}"
  local rc=0
  local exec_env=(
    -e "ZMQ_METHOD=${method}"
    -e "ZMQ_PATH=${path}"
  )
  if [ -n "$body" ]; then
    local b64
    b64="$(printf '%s' "$body" | base64 -w0 2>/dev/null || printf '%s' "$body" | base64 | tr -d '\n')"
    exec_env+=(-e "ZMQ_BODY_B64=${b64}")
  fi
  docker compose exec -T "${exec_env[@]}" zapmass node <<'NODE' || rc=$?
const method = process.env.ZMQ_METHOD || 'GET';
const path = process.env.ZMQ_PATH || '/';
const port = Number(process.env.PORT || 3001);
const url = 'http://127.0.0.1:' + port + path;
const key = String(process.env.ZAPMASS_INTERNAL_MONITOR_KEY || process.env.INTERNAL_MONITOR_KEY || '').trim();
const headers = { Accept: 'application/json' };
if (key) headers['X-Internal-Secret'] = key;
let reqBody = '';
const b64 = String(process.env.ZMQ_BODY_B64 || '').trim();
if (b64) {
  reqBody = Buffer.from(b64, 'base64').toString('utf8');
  headers['Content-Type'] = 'application/json';
}
(async () => {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 25 * 60 * 1000);
  try {
    const init = { method, headers, signal: ac.signal };
    if (reqBody) init.body = reqBody;
    const res = await fetch(url, init);
    const text = await res.text();
    if (!res.ok) {
      process.stderr.write('HTTP ' + res.status + ' ' + path + '\n');
      process.stderr.write((text || '(corpo vazio)').slice(0, 4000) + '\n');
      if (res.status === 404) process.stderr.write('Dica: deploy ZapMass >= 2.3.183.\n');
      process.exit(1);
    }
    if (!text.trim()) {
      process.stderr.write('Resposta HTTP 200 vazia em ' + path + '\n');
      process.exit(1);
    }
    process.stdout.write(text);
  } catch (e) {
    process.stderr.write(String(e && e.message ? e.message : e) + '\n');
    process.exit(1);
  } finally {
    clearTimeout(t);
  }
})();
NODE
  return "$rc"
}

run_diag() {
  echo "=== docker compose ps (zapmass) ==="
  docker compose ps zapmass 2>&1 || true
  echo
  echo "=== GET /api/health ==="
  api_json GET "/api/health" | json_pretty || true
  echo
  echo "=== GET campaign-queue summary (limit=5, rápido) ==="
  api_json GET "/api/internal/campaign-queue/summary?limit=5" | json_pretty || true
  echo
  echo "=== Redis wait ==="
  docker compose exec -T redis redis-cli LLEN bull:campaign-messages:wait 2>&1 || echo "(redis indisponível)"
}

cmd="${1:-summary}"
shift || true

case "$cmd" in
  diag)
    run_diag
    ;;
  summary)
    QS="?limit=30"
    FULL=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --full) FULL=1; QS=""; shift ;;
        --campaign)
          CID="${2:-}"
          if [ -z "$CID" ]; then
            echo "Uso: $0 summary [--full] [--campaign <uuid>]" >&2
            exit 1
          fi
          enc="$(python3 - "$CID" <<'PY'
import sys, urllib.parse
print(urllib.parse.quote(sys.argv[1], safe=''))
PY
)"
          if [ "$FULL" = 1 ]; then
            QS="?campaignId=${enc}"
          else
            QS="?campaignId=${enc}&limit=30"
          fi
          shift 2
          ;;
        *)
          echo "Uso: $0 summary [--full] [--campaign <uuid>]" >&2
          exit 1
          ;;
      esac
    done
    if [ "$FULL" = 1 ] && [ "$QS" = "?limit=30" ]; then
      QS=""
    fi
    if [ -z "$QS" ] || [ "$QS" = "?" ]; then
      echo "Varrendo TODA a fila (~100k jobs pode levar 10–25 min)…" >&2
    else
      echo "Resumo rápido (top campanhas; use --full para varrer tudo)…" >&2
    fi
    api_json GET "/api/internal/campaign-queue/summary${QS}" | json_pretty
    ;;
  dry-run)
    CID="${1:-}"
    if [ -z "$CID" ]; then
      echo "Uso: $0 dry-run <uuid-da-campanha>" >&2
      echo "Ex.: bash $0 dry-run 91bd39d7-5ae8-4df1-99b2-fb34396134c2" >&2
      exit 1
    fi
    PAYLOAD="$(python3 - "$CID" <<'PY'
import json, sys
print(json.dumps({"campaignId": sys.argv[1], "dryRun": True}))
PY
)"
    api_json POST "/api/internal/campaign-queue/purge" "$PAYLOAD" | json_pretty
    ;;
  purge)
    CID="${1:-}"
    if [ -z "$CID" ]; then
      echo "Uso: $0 purge <uuid-da-campanha>" >&2
      exit 1
    fi
    echo "AVISO: remove jobs waiting/delayed/paused da campanha e pausa a campanha na RAM."
    echo "Confirm phrase: PURGE ${CID}"
    read -r -p "Digite exatamente a frase acima: " phrase
    if [ "$phrase" != "PURGE ${CID}" ]; then
      echo "Confirmação incorreta — abortado." >&2
      exit 1
    fi
    PAYLOAD="$(python3 - "$CID" <<'PY'
import json, sys
cid = sys.argv[1]
print(json.dumps({"campaignId": cid, "dryRun": False, "confirm": f"PURGE {cid}", "pauseFirst": True}))
PY
)"
    api_json POST "/api/internal/campaign-queue/purge" "$PAYLOAD" | json_pretty
    ;;
  *)
    echo "Comandos: summary [--full] [--campaign uuid] | dry-run <uuid> | purge <uuid> | diag" >&2
    exit 1
    ;;
esac
