#!/usr/bin/env bash
# Remove instancias Evolution com prefixo uid__ (formato antigo — QR nao gerava).
set -euo pipefail
cd /opt/zapmass
API_KEY="$(grep '^EVOLUTION_API_KEY=' .env | cut -d= -f2- | tr -d '\r')"
API_KEY="${API_KEY:-zapmass-secure-key-2026}"
TMP="$(mktemp)"
curl -sf -H "apikey: $API_KEY" http://127.0.0.1:8080/instance/fetchInstances -o "$TMP"
export TMP API_KEY
python3 <<'PY'
import json, os, urllib.request
path = os.environ["TMP"]
key = os.environ["API_KEY"]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
items = data if isinstance(data, list) else data.get("instances") or []
deleted = kept = 0
for item in items:
    if not isinstance(item, dict):
        continue
    name = str(item.get("name") or item.get("instanceName") or "").strip()
    if "__" not in name:
        kept += 1
        continue
    for method, url in [
        ("DELETE", f"http://127.0.0.1:8080/instance/logout/{name}"),
        ("DELETE", f"http://127.0.0.1:8080/instance/delete/{name}"),
    ]:
        req = urllib.request.Request(url, headers={"apikey": key}, method=method)
        try:
            urllib.request.urlopen(req, timeout=25)
        except Exception:
            pass
    print(f"apagada (formato uid__): {name}")
    deleted += 1
print(f"\nResumo: mantidas sem __ = {kept}, apagadas uid__ = {deleted}")
PY
rm -f "$TMP"
echo "Depois: git pull && ZAPMASS_DOCKER_BUILD_NO_CACHE=1 bash deployment/vps-deploy.sh"
