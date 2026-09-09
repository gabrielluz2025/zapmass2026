#!/usr/bin/env bash
# Remove instâncias Evolution zumbis (created/connecting órfãs). Mantém open e chips pareados.
# Compatível Evolution Go (8081, UUID) e Evolution API legada (8080).
set -euo pipefail
cd "${ROOT:-/opt/zapmass}"

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
    key="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_GO_KEY=' .env 2>/dev/null | tail -1 \
      | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_GO_KEY=//' | tr -d '\r"' \
      | sed 's/^["'\'']//;s/["'\'']$//' || true)"
    [ -n "$key" ] && printf '%s' "$key" && return 0
    key="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=' .env 2>/dev/null | tail -1 \
      | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=//' | tr -d '\r"' \
      | sed 's/^["'\'']//;s/["'\'']$//' || true)"
    [ -n "$key" ] && printf '%s' "$key" && return 0
    printf '%s' "${EVOLUTION_GO_KEY:-${EVOLUTION_API_KEY:-zapmass-secure-key-2026}}"
    return 0
  fi
  key="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=' .env 2>/dev/null | tail -1 \
    | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=//' | tr -d '\r"' \
    | sed 's/^["'\'']//;s/["'\'']$//' || true)"
  printf '%s' "${key:-zapmass-secure-key-2026}"
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
IS_GO=0
is_evolution_go_engine && IS_GO=1

if [ "$IS_GO" = "1" ]; then
  INST_PATH="/instance/all"
else
  INST_PATH="/instance/fetchInstances"
fi

TMP="$(mktemp)"
curl -sf -H "apikey: $API_KEY" "${EVO_URL}${INST_PATH}" -o "$TMP" || {
  echo "ERR: falha ao listar ${INST_PATH} em ${EVO_URL}" >&2
  rm -f "$TMP"
  exit 1
}

export TMP API_KEY EVO_URL IS_GO
python3 <<'PY'
import json, os, re, urllib.request

path = os.environ["TMP"]
key = os.environ["API_KEY"]
evo_url = os.environ["EVO_URL"].rstrip("/")
is_go = os.environ.get("IS_GO") == "1"

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)

def pick_uuid(item):
    for k in ("id", "ID", "instanceId", "hash"):
        v = item.get(k)
        if isinstance(v, str) and UUID_RE.match(v.strip()):
            return v.strip()
    return None

def req(method, url_path, headers=None):
    h = {"apikey": key}
    if headers:
        h.update(headers)
    req_obj = urllib.request.Request(f"{evo_url}{url_path}", headers=h, method=method)
    with urllib.request.urlopen(req_obj, timeout=25) as resp:
        return resp.status

with open(path, encoding="utf-8") as f:
    data = json.load(f)
if isinstance(data, list):
    items = data
elif isinstance(data, dict):
    items = data.get("data") or data.get("instances") or []
else:
    items = []

def is_paired_or_online(item: dict) -> bool:
    if item.get("connected") is True:
        return True
    status = str(item.get("connectionStatus") or item.get("state") or item.get("status") or "").lower()
    if status == "open":
        return True
    jid = str(item.get("jid") or "").strip()
    # Chip pareado (offline ou online) — não apagar
    if jid and "@s.whatsapp.net" in jid:
        return True
    return False

kept = deleted = failed = 0
for item in items:
    if not isinstance(item, dict):
        continue
    name = str(item.get("name") or item.get("instanceName") or "").strip()
    if not name.startswith("conn_"):
        continue
    if is_paired_or_online(item):
        print(f"MANTER (online/pareado): {name}")
        kept += 1
        continue

    go_uuid = pick_uuid(item)
    if is_go:
        if not go_uuid:
            print(f"SKIP sem UUID: {name}")
            failed += 1
            continue
        delete_path = f"/instance/delete/{go_uuid}"
        headers = {"apikey": key}
        token = item.get("token")
        if isinstance(token, str) and token.strip():
            try:
                req("DELETE", "/instance/logout", {"apikey": token.strip()})
            except Exception:
                pass
    else:
        delete_path = f"/instance/delete/{name}"
        headers = {"apikey": key}

    try:
        req("DELETE", delete_path, headers)
        status = str(item.get("connectionStatus") or item.get("state") or "zumbi").lower()
        print(f"apagada ({status}): {name}")
        deleted += 1
    except Exception as e:
        print(f"falha {name}: {e}")
        failed += 1

print(f"\nResumo: mantidas open={kept}, apagadas={deleted}, falhas={failed}")
PY
rm -f "$TMP"
echo ""
echo "Dica: após deploy v2.3.102+, o reconciler automático roda a cada 15 min na API."
echo "Manual completo: bash deployment/vps-reconcile-go-instances.sh"
