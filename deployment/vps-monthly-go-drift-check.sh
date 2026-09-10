#!/usr/bin/env bash
# Checklist drift Evolution Go ↔ ZapMass (conn_*). Manual ou via cron semanal.
# Uso: cd /opt/zapmass && bash deployment/vps-monthly-go-drift-check.sh
#      FIX=1 bash deployment/vps-monthly-go-drift-check.sh  # limpa zumbis + reconnect (sem apagar chips pareados)
# Cron semanal (dom 07:00 BRT): sudo bash deployment/install-go-drift-weekly-cron.sh
set -euo pipefail
cd "${ROOT:-/opt/zapmass}"

read_api_key() {
  local key
  key="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_GO_KEY=' .env 2>/dev/null | tail -1 \
    | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_GO_KEY=//' | tr -d '\r"' \
    | sed "s/^['\"]//;s/['\"]$//" || true)"
  if [ -n "$key" ]; then printf '%s' "$key"; return 0; fi
  key="$(grep -E '^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=' .env 2>/dev/null | tail -1 \
    | sed -E 's/^[[:space:]]*(export[[:space:]]+)?EVOLUTION_API_KEY=//' | tr -d '\r"' \
    | sed "s/^['\"]//;s/['\"]$//" || true)"
  printf '%s' "${key:-zapmass-secure-key-2026}"
}

HP="$(grep -E '^HOST_PORT=' .env 2>/dev/null | tail -1 | sed 's/^HOST_PORT=//' | tr -d $'\r"\'')" || true
HP="${HP:-3001}"
API_KEY="$(read_api_key)"
EVO_URL="${EVOLUTION_GO_URL:-http://127.0.0.1:8081}"
EVO_URL="${EVO_URL%/}"
FIX="${FIX:-0}"

echo "══════════════════════════════════════════════════════════════"
echo " ZapMass — checklist mensal Go ↔ settings ($(date -Is))"
echo "══════════════════════════════════════════════════════════════"
echo ""

echo "==> 1/4 Infra"
docker compose ps zapmass evolution-go postgres redis 2>/dev/null | tail -n +2 || true
HEALTH="$(curl -sf "http://127.0.0.1:${HP}/api/health" 2>/dev/null || echo '{}')"
API_VER="$(echo "$HEALTH" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
APP_VER="$(echo "$HEALTH" | sed -n 's/.*"appVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
echo "    API health: $(echo "$HEALTH" | grep -q '"status":"ok"' && echo OK || echo FALHA) version=${API_VER:-?} app=${APP_VER:-?}"
echo "    .env: EVOLUTION_SYNC_FULL_HISTORY=$(grep -E '^EVOLUTION_SYNC_FULL_HISTORY=' .env 2>/dev/null | tail -1 | cut -d= -f2- || echo '?')"
echo "    .env: GO_INSTANCE_RECONCILE_INTERVAL_MS=$(grep -E '^GO_INSTANCE_RECONCILE_INTERVAL_MS=' .env 2>/dev/null | tail -1 | cut -d= -f2- || echo '900000 (default)')"
echo "    .env: GO_INSTANCE_RECONCILE_REPAIR=$(grep -E '^GO_INSTANCE_RECONCILE_REPAIR=' .env 2>/dev/null | tail -1 | cut -d= -f2- || echo '1 (default)')"
echo ""

echo "==> 2/4 Drift Go vs settings vs tombstones"
export API_KEY EVO_URL HP
python3 <<'PY'
import json, os, subprocess, sys, urllib.request

key = os.environ["API_KEY"]
evo = os.environ["EVO_URL"].rstrip("/")
hp = os.environ.get("HP", "3001")

def load_json_file_in_container(script: str):
    try:
        out = subprocess.check_output(
            ["docker", "compose", "exec", "-T", "zapmass", "python3", "-c", script],
            stderr=subprocess.DEVNULL,
            text=True,
        )
        return json.loads(out.strip() or "{}")
    except Exception:
        return None

settings_raw = load_json_file_in_container(
    "import json; print(json.dumps(json.load(open('/app/data/connections_settings.json'))))"
)
tomb_raw = load_json_file_in_container(
    "import json; p='/app/data/deleted_connections.json'; "
    "print(json.dumps(json.load(open(p)) if __import__('pathlib').Path(p).exists() else []))"
)
settings = settings_raw if isinstance(settings_raw, dict) else {}
settings_keys = sorted(k for k in settings if k.startswith("conn_"))
tombstones = set(tomb_raw) if isinstance(tomb_raw, list) else set()

try:
    with urllib.request.urlopen(
        urllib.request.Request(f"{evo}/instance/all", headers={"apikey": key}), timeout=25
    ) as resp:
        data = json.load(resp)
except Exception as e:
    print(f"ERR: /instance/all falhou: {e}")
    sys.exit(1)

go_list = data if isinstance(data, list) else data.get("data") or []
go_by_name = {}
for item in go_list:
    if not isinstance(item, dict):
        continue
    name = str(item.get("name") or item.get("instanceName") or "").strip()
    if not name.startswith("conn_"):
        continue
    go_by_name.setdefault(name, []).append(item)

go_names = set(go_by_name)
settings_set = set(settings_keys)
connected = sum(1 for items in go_by_name.values() for x in items if x.get("connected"))

print(f"    Go instâncias (conn_*): {len(go_list)} nomes únicos={len(go_names)} connected={connected}")
print(f"    Settings (conn_*):      {len(settings_keys)}")
print(f"    Tombstones:             {len(tombstones)}")
print("")

only_go = sorted(go_names - settings_set)
only_settings = sorted(settings_set - go_names)
in_both = sorted(go_names & settings_set)
dup_names = {n: rows for n, rows in go_by_name.items() if len(rows) > 1}

def jid_of(row):
    return str(row.get("jid") or "-").split(":")[0]

print("--- Em Go e settings ---")
for n in in_both:
    rows = go_by_name[n]
    st = "ON" if any(r.get("connected") for r in rows) else "off"
    uuids = len({str(r.get("id") or r.get("ID") or "") for r in rows})
    warn = "  AVISO: duplicata UUID" if uuids > 1 else ""
    print(f"    {n}  {st}  jid={jid_of(rows[0])}{warn}")

print("")
print("--- Só no Go (órfãs / drift) ---")
if not only_go:
    print("    (nenhuma)")
else:
    for n in only_go:
        rows = go_by_name[n]
        st = "ON" if any(r.get("connected") for r in rows) else "off"
        tomb = "tombstone" if n in tombstones else "sem tombstone"
        print(f"    {n}  {st}  jid={jid_of(rows[0])}  ({tomb})")

print("")
print("--- Só em settings (falta Go) ---")
if not only_settings:
    print("    (nenhuma)")
else:
    for n in only_settings:
        tomb = "tombstone" if n in tombstones else "ativo"
        print(f"    {n}  ({tomb})")

print("")
print("--- Duplicatas UUID (mesmo conn_*) ---")
if not dup_names:
    print("    (nenhuma)")
else:
    for n, rows in sorted(dup_names.items()):
        print(f"    {n}: {len(rows)} instâncias no Go")

# Verdict + exit code
issues = 0
if len(go_names) > len(settings_set):
    issues += 1
if only_settings:
    issues += 1
if dup_names:
    issues += 1
if only_go:
    issues += 1

print("")
print("==> 3/4 Diagnóstico")
if issues == 0 and len(go_names) == len(settings_set):
    print("    OK: Go e settings alinhados (1:1). Nenhuma ação obrigatória.")
elif len(go_names) > len(settings_set) or only_go or dup_names:
    print("    ATENÇÃO: drift detectado — risco de ciclo de órfãs se ignorar.")
    if only_go:
        print("    • Go sem settings: reconciler v2.3.106+ apaga offline; tombstoned apaga mesmo online.")
    if dup_names:
        print("    • Duplicatas UUID: dedupe automático no reconciler (v2.3.106+).")
    if only_settings:
        print("    • Settings sem Go: repair recria se GO_INSTANCE_RECONCILE_REPAIR=1.")
else:
    print("    REVISAR: drift menor — conferir lista acima.")

print("")
print("==> 4/4 O que fazer")
print("    Rotina OK (sem apagar chips pareados):")
print("      bash deployment/vps-cleanup-evolution-instances.sh")
if in_both:
    for n in in_both:
        print(f"      KEEP={n} bash deployment/vps-reconnect-single-chip.sh")
else:
    print("      KEEP=conn_SEU_ID bash deployment/vps-reconnect-single-chip.sh  # use um id listado acima")
print("")
print("    Drift forte (Go >> settings, ex. Go=20 settings=5):")
print("      1) Pausar campanhas na UI")
print("      2) Apagar canais pela UI (gera tombstone) — não só na VPS")
print("      3) GO_INSTANCE_RECONCILE_REPAIR=0 no .env durante limpeza manual")
print("      4) bash deployment/vps-keep-single-chip.sh  # ou multi-canal: reconcile + UI")
print("      5) GO_INSTANCE_RECONCILE_REPAIR=1 e aguardar reconciler (1h no seu .env)")
print("")
print("    Nunca:")
print("      • vps-keep-single-chip.sh em loop")
print("      • docker compose restart zapmass sem motivo")
print("      • vps-cleanup + restart repetidos (reconciler ressuscita zumbis)")
print("")
print("    Admin (token): GET /api/admin/go-instances/drift")
print("                   POST /api/admin/go-instances/reconcile?dryRun=1")
print("")
print("    Cron semanal automático (dom 07:00 BRT):")
print("      sudo bash deployment/install-go-drift-weekly-cron.sh")
print("      tail -80 /var/log/zapmass-go-drift-weekly.log")

sys.exit(1 if issues else 0)
PY
DRIFT_EXIT=$?

echo ""
if [ "$FIX" = "1" ]; then
  echo "==> FIX=1 — limpeza leve (zumbis + reconnect chips em settings)"
  bash deployment/vps-cleanup-evolution-instances.sh || true
  KEEP_LIST="$(docker compose exec -T zapmass python3 -c "
import json
s=json.load(open('/app/data/connections_settings.json'))
print(' '.join(sorted(k for k in s if k.startswith('conn_'))))
" 2>/dev/null || true)"
  for conn in $KEEP_LIST; do
    KEEP="$conn" bash deployment/vps-reconnect-single-chip.sh 2>/dev/null || true
  done
  echo "    FIX concluído — rode o checklist de novo sem FIX=1."
fi

if [ "$DRIFT_EXIT" -eq 0 ]; then
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  Checklist OK — sem drift crítico                            "
  echo "╚══════════════════════════════════════════════════════════════╝"
else
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  Drift detectado — siga passos da seção 4/4 acima           "
  echo "║  Correção leve: FIX=1 bash deployment/vps-monthly-go-drift-check.sh"
  echo "╚══════════════════════════════════════════════════════════════╝"
  exit 1
fi
