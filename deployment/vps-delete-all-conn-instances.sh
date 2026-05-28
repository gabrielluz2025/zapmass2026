#!/usr/bin/env bash
# Apaga TODAS as instâncias Evolution conn_* (inclui open/connecting zumbis).
# Use depois de corrigir CONFIG_SESSION e antes de "Nova conexão" no painel.
# Uso: cd /opt/zapmass && bash deployment/vps-delete-all-conn-instances.sh
set -euo pipefail
cd /opt/zapmass
API_KEY="$(grep -E '^[[:space:]]*EVOLUTION_API_KEY=' .env | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//')"
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
deleted = 0
for item in items:
    if not isinstance(item, dict):
        continue
    name = str(item.get("name") or item.get("instanceName") or "").strip()
    if not name.startswith("conn_"):
        continue
    status = str(item.get("connectionStatus") or item.get("state") or "").lower()
    for path in (f"/instance/logout/{name}", f"/instance/delete/{name}"):
        req = urllib.request.Request(
            f"http://127.0.0.1:8080{path}",
            headers={"apikey": key},
            method="DELETE",
        )
        try:
            urllib.request.urlopen(req, timeout=25)
        except Exception:
            pass
    print(f"apagada ({status}): {name}")
    deleted += 1
print(f"\nResumo: conn_* apagadas={deleted}")
PY
rm -f "$TMP"
echo "==> Reinicie API para limpar memória: docker service update --force zapmass_api"
echo "==> No site: Ctrl+F5 → apague o card (lixeira) se ainda aparecer → Nova conexão → Gerar QR"
