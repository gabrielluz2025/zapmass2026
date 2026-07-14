#!/usr/bin/env bash
# Auditoria de isolamento de conversas — detecta canais com ownerUid suspeito ou ausente.
#
# USO (na VPS):
#   cd /opt/zapmass && bash deployment/audit-conversation-isolation.sh
#   cd /opt/zapmass/clientes/demo && bash ../../deployment/audit-conversation-isolation.sh

set -euo pipefail
ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
DATA_DIR="${DATA_DIR:-${ROOT}/data}"
SETTINGS="${DATA_DIR}/connections_settings.json"
CACHE="${DATA_DIR}/conversations_cache.json"

echo "=== Auditoria isolamento conversas — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "DATA_DIR=${DATA_DIR}"
echo

if [ ! -f "$SETTINGS" ]; then
  echo "[aviso] connections_settings.json não encontrado em ${SETTINGS}"
else
  echo "Canais em connections_settings.json:"
  python3 - <<'PY' "$SETTINGS"
import json, sys
p = sys.argv[1]
with open(p) as f: d = json.load(f)
rows = []
for cid, meta in sorted(d.items()):
    if not isinstance(meta, dict): continue
    ou = (meta.get('ownerUid') or meta.get('createdByUid') or '').strip()
    fn = (meta.get('friendlyName') or '').strip()
    rows.append((cid, ou or '—', fn or '—'))
print(f"{'CANAL':<36} {'OWNER':<28} NOME")
print('-' * 90)
for cid, ou, fn in rows:
    flag = ''
    if not ou or ou == '—':
        flag = ' [SEM OWNER]'
    elif '__' not in cid and cid.startswith('conn_'):
        flag = ' [LEGADO]'
    print(f"{cid:<36} {ou:<28} {fn[:20]}{flag}")
print(f"\nTotal: {len(rows)}")
orphans = [c for c, ou, _ in rows if ou == '—']
if orphans:
    print(f"\n[ALERTA] {len(orphans)} canal(is) sem ownerUid — risco de vazamento se reconciliados errado.")
PY
fi

echo
if [ ! -f "$CACHE" ]; then
  echo "[ok] Sem conversations_cache.json (ou vazio)."
else
  echo "Conversas em cache vs owners:"
  python3 - <<'PY' "$CACHE" "$SETTINGS"
import json, sys
cache_p, settings_p = sys.argv[1], sys.argv[2]
with open(cache_p) as f: convs = json.load(f)
owners = {}
try:
    with open(settings_p) as f:
        raw = json.load(f)
    for cid, meta in raw.items():
        if isinstance(meta, dict):
            owners[cid] = (meta.get('ownerUid') or meta.get('createdByUid') or '').strip()
except FileNotFoundError:
    pass
by_owner = {}
orphan = 0
for c in convs if isinstance(convs, list) else []:
    cid = str(c.get('connectionId') or '')
    ou = owners.get(cid, '')
    if not ou:
        orphan += 1
        ou = '(sem owner)'
    by_owner[ou] = by_owner.get(ou, 0) + 1
print(f"Total conversas em cache: {len(convs) if isinstance(convs, list) else 0}")
for ou, n in sorted(by_owner.items(), key=lambda x: -x[1]):
    print(f"  {ou}: {n}")
if orphan:
    print(f"\n[ALERTA] {orphan} conversa(s) de canais sem ownerUid no settings.")
PY
fi

echo
echo "Correção recomendada (container principal ou cliente Plano B):"
echo "  1. Reiniciar após deploy: docker compose restart zapmass  (ou zapmass-cli-<slug>)"
echo "  2. Conferir logs: 'Conversas sem ownerUid removidas' / 'canais reatribuídos'"
echo "  3. Dry-run reconcile: node -e \"import('./server/reconcileConnectionOwners.js').then(m=>m.autoReconcileConnectionOwners({dryRun:true}))\""
