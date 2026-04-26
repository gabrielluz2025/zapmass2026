# RUNBOOK OPERADOR (ENXUTO)

## Deploy seguro

```bash
set -euo pipefail
cd /opt/zapmass
git fetch --all --prune
git checkout main
git pull --ff-only
docker build -t zapmass:latest .
docker stack deploy -c docker-stack.yml zapmass --with-registry-auth
```

## Validacao rapida (PASS/FAIL)

```bash
set -euo pipefail

TASK_ID="$(docker service ps --no-trunc --filter desired-state=running -q zapmass_api | head -n 1)"
[ -n "${TASK_ID:-}" ] || { echo "FAIL: sem task running"; exit 1; }

CONTAINER_ID="$(docker inspect -f '{{.Status.ContainerStatus.ContainerID}}' "$TASK_ID")"
[ -n "${CONTAINER_ID:-}" ] || { echo "FAIL: sem container ativo"; exit 1; }

HEALTH_JSON="$(curl -fsS http://127.0.0.1:3001/api/health)"
ROUTER_JSON="$(curl -fsS http://127.0.0.1:3001/api/session-router/metrics)"
LOGS="$(docker logs --since 90s --tail 200 "$CONTAINER_ID" 2>&1 || true)"

echo "$HEALTH_JSON" | grep -q '"status":"ok"' || { echo "FAIL: health"; exit 1; }
echo "$ROUTER_JSON" | grep -q '"aliveWorkers":1' || { echo "FAIL: aliveWorkers"; exit 1; }
if echo "$LOGS" | grep -Eqi 'process_singleton_posix|browser_lock|Failed to launch the browser process'; then
  echo "FAIL: lock critico"
  exit 1
fi

echo "PASS: ambiente saudavel"
```

## Monitoramento 10 segundos

```bash
docker service ps zapmass_api --filter desired-state=running
curl -fsS http://127.0.0.1:3001/api/health && echo
curl -fsS http://127.0.0.1:3001/api/session-router/metrics && echo
```

