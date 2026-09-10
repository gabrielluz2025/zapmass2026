#!/usr/bin/env bash
# Mantém um único chip (Go + settings + tombstones). Apaga todos os outros conn_* no Evolution Go.
# Uso: cd /opt/zapmass && bash deployment/vps-keep-single-chip.sh
#      KEEP=conn_XXXX bash deployment/vps-keep-single-chip.sh
#      FORCE=1 — refaz limpeza mesmo se já estiver com 1 chip
# Se já limpo (Go=1, settings=1): não para zapmass; só reconecta o chip.
set -euo pipefail
cd "${ROOT:-/opt/zapmass}"

KEEP="${KEEP:-conn_1788998154797_1}"
FORCE="${FORCE:-0}"

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

set_env_kv() {
  local key="$1" val="$2"
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" .env 2>/dev/null; then
    sed -i "s|^[[:space:]]*\(export[[:space:]]\+\)\?${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

API_KEY="$(read_api_key)"
EVO_URL="${EVOLUTION_GO_URL:-http://127.0.0.1:8081}"
EVO_URL="${EVO_URL%/}"

echo "══════════════════════════════════════════════════════════════"
echo " ZapMass — manter só ${KEEP}"
echo "══════════════════════════════════════════════════════════════"

echo ""
echo "==> 0/7 Pré-checagem"
already_clean="$(KEEP="${KEEP}" FORCE="${FORCE}" API_KEY="${API_KEY}" EVO_URL="${EVO_URL}" python3 <<'PY'
import json, os, subprocess, urllib.request

key = os.environ["API_KEY"]
evo = os.environ["EVO_URL"].rstrip("/")
keep = os.environ["KEEP"]
force = os.environ.get("FORCE", "0") == "1"

def settings_count():
    try:
        out = subprocess.check_output(
            [
                "docker", "compose", "run", "--rm", "--no-deps", "--entrypoint", "python3", "zapmass",
                "-c",
                "import json; s=json.load(open('/app/data/connections_settings.json')); "
                "print(len([k for k in s if k.startswith('conn_')]))",
            ],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        return int(out or "0")
    except Exception:
        return -1

try:
    with urllib.request.urlopen(
        urllib.request.Request(f"{evo}/instance/all", headers={"apikey": key}), timeout=20
    ) as resp:
        data = json.load(resp)
    items = data if isinstance(data, list) else data.get("data") or []
    conn_items = [x for x in items if isinstance(x, dict) and str(x.get("name") or "").startswith("conn_")]
    only_keep = len(conn_items) == 1 and conn_items[0].get("name") == keep
    settings_ok = settings_count() == 1
    print("1" if only_keep and settings_ok and not force else "0")
except Exception:
    print("0")
PY
)"
if [ "$already_clean" = "1" ]; then
  echo "Já limpo: Go=1 settings=1 — pulando stop/delete (use FORCE=1 para refazer)"
fi

echo ""
echo "==> 1/7 .env"
set_env_kv "EVOLUTION_SYNC_FULL_HISTORY" "0"
set_env_kv "GO_INSTANCE_RECONCILE_INTERVAL_MS" "3600000"

if [ "$already_clean" = "1" ]; then
  echo ""
  echo "==> 2–5/7 Pulados (sem parar zapmass)"
  echo ""
  echo "==> 6/7 Reconectar chip"
  bash deployment/vps-reconnect-single-chip.sh
  echo ""
  echo "--- Go ---"
  curl -sf -H "apikey: ${API_KEY}" "${EVO_URL}/instance/all" | python3 -c "
import sys, json
d = json.load(sys.stdin)
l = d.get('data', d)
print('total:', len(l), 'connected:', sum(1 for x in l if x.get('connected')))
for x in sorted(l, key=lambda i: i.get('name','')):
    print(x['name'], 'ON' if x.get('connected') else 'off', (x.get('jid') or '-').split(':')[0])
"
  echo ""
  echo "Meta: total Go=1, connected=1. Se off → UI → Gerar QR."
  exit 0
fi

echo ""
echo "==> 2/7 Parando zapmass"
docker compose stop zapmass 2>/dev/null || true

echo ""
echo "==> 3/7 Settings + tombstones"
docker compose run --rm --no-deps -e KEEP="${KEEP}" --entrypoint python3 zapmass -c "
import json, os
from pathlib import Path

keep = os.environ['KEEP'].strip()
data = Path('/app/data')
settings_path = data / 'connections_settings.json'
deleted_path = data / 'deleted_connections.json'

settings = {}
if settings_path.exists():
    try:
        settings = json.loads(settings_path.read_text(encoding='utf-8') or '{}')
    except Exception:
        settings = {}

deleted = []
if deleted_path.exists():
    try:
        raw = json.loads(deleted_path.read_text(encoding='utf-8') or '[]')
        if isinstance(raw, list):
            deleted = [x for x in raw if isinstance(x, str)]
    except Exception:
        deleted = []

removed = []
for k in list(settings.keys()):
    if not k.startswith('conn_'):
        continue
    if k == keep:
        continue
    removed.append(k)
    del settings[k]
    if k not in deleted:
        deleted.append(k)

settings_path.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
deleted_path.write_text(json.dumps(sorted(set(deleted)), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('settings restantes:', len([k for k in settings if k.startswith('conn_')]))
print('removidos:', len(removed))
for x in sorted(removed):
    print('  -', x)
print('tombstones:', len(deleted))
"

echo ""
echo "==> 4/7 Apagar instancias Go (exceto ${KEEP})"
export API_KEY EVO_URL KEEP
python3 <<'PY'
import json, os, re, urllib.request, time

key = os.environ["API_KEY"]
evo = os.environ["EVO_URL"].rstrip("/")
keep = os.environ["KEEP"]
uuid_re = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

def req(method, path, headers=None):
    h = {"apikey": key}
    if headers:
        h.update(headers)
    r = urllib.request.Request(f"{evo}{path}", headers=h, method=method)
    with urllib.request.urlopen(r, timeout=30) as resp:
        return resp.status

with urllib.request.urlopen(
    urllib.request.Request(f"{evo}/instance/all", headers={"apikey": key}), timeout=30
) as resp:
    data = json.load(resp)

items = data if isinstance(data, list) else data.get("data") or data.get("instances") or []

deleted = skipped = failed = 0
for item in items:
    if not isinstance(item, dict):
        continue
    name = str(item.get("name") or item.get("instanceName") or "").strip()
    if not name.startswith("conn_"):
        continue
    if name == keep:
        print(f"MANTER: {name}")
        skipped += 1
        continue

    go_uuid = None
    for k in ("id", "ID", "instanceId", "hash"):
        v = item.get(k)
        if isinstance(v, str) and uuid_re.match(v.strip()):
            go_uuid = v.strip()
            break

    token = item.get("token")
    if isinstance(token, str) and token.strip():
        try:
            req("DELETE", "/instance/logout", {"apikey": token.strip()})
        except Exception:
            pass
        time.sleep(0.4)

    try:
        if go_uuid:
            req("DELETE", f"/instance/delete/{go_uuid}")
        else:
            req("DELETE", f"/instance/delete/{name}")
        jid = str(item.get("jid") or "-").split(":")[0]
        conn = "ON" if item.get("connected") else "off"
        print(f"apagada ({conn}, {jid}): {name}")
        deleted += 1
        time.sleep(0.4)
    except Exception as e:
        print(f"falha {name}: {e}")
        failed += 1

print(f"\nResumo Go: mantidas={skipped}, apagadas={deleted}, falhas={failed}")
PY

echo ""
echo "==> 5/7 Zumbis sem jid"
bash deployment/vps-cleanup-evolution-instances.sh || true

echo ""
echo "==> 6/7 Subindo zapmass"
docker compose up -d zapmass

for i in $(seq 1 24); do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3001/api/health 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    echo "API OK (tentativa $i)"
    break
  fi
  sleep 5
done

echo ""
echo "==> 7/7 Reconectar chip + validacao"
bash deployment/vps-reconnect-single-chip.sh || true

echo ""
echo "--- Go ---"
curl -sf -H "apikey: ${API_KEY}" "${EVO_URL}/instance/all" | python3 -c "
import sys, json
d = json.load(sys.stdin)
l = d.get('data', d)
print('total:', len(l), 'connected:', sum(1 for x in l if x.get('connected')))
for x in sorted(l, key=lambda i: i.get('name','')):
    print(x['name'], 'ON' if x.get('connected') else 'off', (x.get('jid') or '-').split(':')[0])
"

echo ""
echo "--- Settings ---"
docker compose exec -T zapmass python3 -c "
import json
s = json.load(open('/app/data/connections_settings.json'))
keys = sorted(k for k in s if k.startswith('conn_'))
print('settings:', len(keys), keys)
"

echo ""
echo "Meta: total Go=1, connected=1, settings=['${KEEP}']"
echo "Não rode este script em loop — cada restart derruba a sessão WA."
echo "Só reconectar: bash deployment/vps-reconnect-single-chip.sh"
echo "Se connected=0 após reconnect → UI → Gerar QR (554797543152)"
