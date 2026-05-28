#!/usr/bin/env bash
# Remove instancias Evolution presas em "connecting" (zumbis). Mantem as abertas (open).
set -euo pipefail
cd /opt/zapmass
API_KEY="$(grep '^EVOLUTION_API_KEY=' .env | cut -d= -f2- | tr -d '\r')"
API_KEY="${API_KEY:-zapmass-secure-key-2026}"
TMP="$(mktemp)"
curl -sf -H "apikey: $API_KEY" http://127.0.0.1:8080/instance/fetchInstances -o "$TMP"
export TMP API_KEY
python3 <<PY
import json, os, urllib.request
path = os.environ["TMP"]
key = os.environ["API_KEY"]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
items = data if isinstance(data, list) else data.get("instances") or []
kept = deleted = 0
for item in items:
    if not isinstance(item, dict):
        continue
    name = str(item.get("name") or item.get("instanceName") or "").strip()
    status = str(item.get("connectionStatus") or item.get("state") or "").lower()
    if not name.startswith("conn_"):
        continue
    if status == "open":
        print(f"MANTER open: {name}")
        kept += 1
        continue
    req = urllib.request.Request(
        f"http://127.0.0.1:8080/instance/delete/{name}",
        headers={"apikey": key},
        method="DELETE",
    )
    try:
        urllib.request.urlopen(req, timeout=25)
        print(f"apagada ({status}): {name}")
        deleted += 1
    except Exception as e:
        print(f"falha {name}: {e}")
print(f"\nResumo: mantidas open={kept}, apagadas={deleted}")
PY
rm -f "$TMP"
echo "Reinicie API se o painel ainda estiver vazio: docker service update --force zapmass_api"
