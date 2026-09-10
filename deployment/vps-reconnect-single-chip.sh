#!/usr/bin/env bash
# Reconecta um chip pareado no Evolution Go sem parar a API ZapMass.
# Uso: cd /opt/zapmass && bash deployment/vps-reconnect-single-chip.sh
#      KEEP=conn_XXXX bash deployment/vps-reconnect-single-chip.sh
set -euo pipefail
cd "${ROOT:-/opt/zapmass}"

KEEP="${KEEP:-conn_1788998154797_1}"
WAIT_SEC="${WAIT_SEC:-90}"

read_api_key() {
  local key
  key="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_GO_KEY=' .env 2>/dev/null | tail -1 \
    | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_GO_KEY=//' | tr -d '\r"' \
    | sed "s/^['\"]//;s/['\"]$//" || true)"
  if [ -n "$key" ]; then
    printf '%s' "$key"
    return 0
  fi
  key="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=' .env 2>/dev/null | tail -1 \
    | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=//' | tr -d '\r"' \
    | sed "s/^['\"]//;s/['\"]$//" || true)"
  printf '%s' "${key:-zapmass-secure-key-2026}"
}

API_KEY="$(read_api_key)"
EVO_URL="${EVOLUTION_GO_URL:-http://127.0.0.1:8081}"
EVO_URL="${EVO_URL%/}"

echo "==> Reconectar ${KEEP} no Evolution Go"

export API_KEY EVO_URL KEEP WAIT_SEC
python3 <<'PY'
import json, os, sys, time, urllib.parse, urllib.request

key = os.environ["API_KEY"]
evo = os.environ["EVO_URL"].rstrip("/")
keep = os.environ["KEEP"].strip()
wait_sec = int(os.environ.get("WAIT_SEC", "90"))


def http(method, path, headers=None, body=None):
    h = {"apikey": key}
    if headers:
        h.update(headers)
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        h.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(f"{evo}{path}", headers=h, method=method, data=data)
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        if not raw.strip():
            return resp.status, None
        try:
            return resp.status, json.loads(raw)
        except json.JSONDecodeError:
            return resp.status, raw


def list_instances():
    _, data = http("GET", "/instance/all")
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("data") or data.get("instances") or []
    return []


def find_chip(items):
    for item in items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("instanceName") or "").strip()
        if name == keep:
            return item
    return None


def poll_connected():
    deadline = time.time() + wait_sec
    while time.time() < deadline:
        chip = find_chip(list_instances())
        if chip and chip.get("connected") is True:
            jid = str(chip.get("jid") or "-").split(":")[0]
            print(f"OK: {keep} connected=ON jid={jid}")
            return 0
        time.sleep(5)
    chip = find_chip(list_instances())
    jid = str((chip or {}).get("jid") or "-").split(":")[0]
    print(f"AVISO: {keep} ainda off após {wait_sec}s (jid={jid})")
    print("Próximo passo: UI → Conexões → Gerar QR no chip", jid)
    return 1


items = list_instances()
chip = find_chip(items)
if not chip:
    print(f"ERR: instância {keep} não encontrada no Go (total={len(items)})")
    sys.exit(1)

if chip.get("connected") is True:
    jid = str(chip.get("jid") or "-").split(":")[0]
    print(f"OK: {keep} já connected=ON jid={jid}")
    sys.exit(0)

token = str(chip.get("token") or "").strip()
go_uuid = str(chip.get("id") or chip.get("ID") or "").strip()
enc = urllib.parse.quote(keep)

print(f"chip off — tentando reconnect (token={'sim' if token else 'nao'})")

if token:
    try:
        http("POST", "/instance/reconnect", {"apikey": token})
        print("POST /instance/reconnect (token) OK")
        if poll_connected() == 0:
            sys.exit(0)
    except Exception as e:
        print(f"reconnect token falhou: {e}")

try:
    http("POST", f"/instance/restart/{enc}", {})
    print(f"POST /instance/restart/{keep} OK — aguardando {wait_sec}s")
    time.sleep(5)
    if poll_connected() == 0:
        sys.exit(0)
except Exception as e:
    print(f"restart falhou: {e}")

try:
    http("POST", f"/instance/connect/{enc}", {"forceReconnect": True})
    print(f"POST /instance/connect/{keep} forceReconnect OK")
    time.sleep(3)
    sys.exit(poll_connected())
except Exception as e:
    print(f"connect falhou: {e}")
    if go_uuid:
        try:
            webhook = str(chip.get("webhook") or "http://zapmass:3001/webhook/evolution").strip()
            http(
                "POST",
                "/instance/connect",
                {"apikey": token or key, "instanceId": go_uuid, "Content-Type": "application/json"},
                {"webhookUrl": webhook, "subscribe": ["ALL"], "immediate": True},
            )
            print("POST /instance/connect (uuid) OK")
            sys.exit(poll_connected())
        except Exception as e2:
            print(f"connect uuid falhou: {e2}")
    sys.exit(1)
PY
