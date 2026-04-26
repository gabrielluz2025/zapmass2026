# RUNBOOK PRODUCAO - ZAPMASS (SWARM)

## 1) Deploy seguro

```bash
set -euo pipefail

cd /opt/zapmass
git fetch --all --prune
git checkout main
git pull --ff-only
docker build -t zapmass:latest .
docker stack deploy -c docker-stack.yml zapmass --with-registry-auth
```

Notas:
- O aviso `image zapmass:latest could not be accessed on a registry` e esperado em cenario sem registry remoto.
- O aviso `Ignoring unsupported options: build` no stack deploy e normal.

## 2) Pos-deploy (PASS/FAIL automatico)

```bash
set -euo pipefail

echo "==[1/6] Descobrindo task/container ativo=="
TASK_ID="$(docker service ps --no-trunc --filter desired-state=running -q zapmass_api | head -n 1)"
[ -n "${TASK_ID:-}" ] || { echo "FAIL: nenhuma task running para zapmass_api"; exit 1; }

CONTAINER_ID="$(docker inspect -f '{{.Status.ContainerStatus.ContainerID}}' "$TASK_ID")"
[ -n "${CONTAINER_ID:-}" ] || { echo "FAIL: container nao resolvido para task ativa"; exit 1; }

echo "TASK_ID=$TASK_ID"
echo "CONTAINER_ID=$CONTAINER_ID"

echo "==[2/6] Status do container=="
docker ps --filter "id=$CONTAINER_ID" --format 'container={{.ID}} name={{.Names}} status={{.Status}}'

echo "==[3/6] Health e metricas=="
HEALTH_JSON="$(curl -fsS http://127.0.0.1:3001/api/health)"
ROUTER_JSON="$(curl -fsS http://127.0.0.1:3001/api/session-router/metrics)"
echo "$HEALTH_JSON"
echo "$ROUTER_JSON"

echo "==[4/6] Logs criticos (ultimos 90s)=="
LOGS="$(docker logs --since 90s --tail 200 "$CONTAINER_ID" 2>&1 || true)"
echo "$LOGS"

echo "==[5/6] Validacao=="
echo "$HEALTH_JSON" | grep -q '"status":"ok"' || { echo "FAIL: health != ok"; exit 1; }
echo "$ROUTER_JSON" | grep -q '"aliveWorkers":1' || { echo "FAIL: aliveWorkers != 1"; exit 1; }
if echo "$LOGS" | grep -Eqi 'process_singleton_posix|browser_lock|Failed to launch the browser process'; then
  echo "FAIL: lock/erro critico detectado nos ultimos 90s"
  exit 1
fi

echo "==[6/6] PASS=="
echo "PASS: deploy saudavel (API ok, worker vivo, sem lock critico recente)."
```

## 3) Diagnostico limpo (sem ruido de task antiga)

Problema comum:
- `docker service logs` mistura historico de tasks antigas e pode mostrar:
  - `warning: incomplete log stream`
  - erros de sessions antigas ja finalizadas

Use este fluxo:

```bash
TASK_ID="$(docker service ps --no-trunc --filter desired-state=running -q zapmass_api | head -n 1)"
CONTAINER_ID="$(docker inspect -f '{{.Status.ContainerStatus.ContainerID}}' "$TASK_ID")"
docker logs --since 2m --tail 200 "$CONTAINER_ID"
```

## 4) Monitoramento rapido (10 segundos)

```bash
docker service ps zapmass_api --filter desired-state=running
curl -fsS http://127.0.0.1:3001/api/health && echo
curl -fsS http://127.0.0.1:3001/api/session-router/metrics && echo
```

Opcional (filtrar so erro critico):

```bash
TASK_ID="$(docker service ps --no-trunc --filter desired-state=running -q zapmass_api | head -n 1)"
CONTAINER_ID="$(docker inspect -f '{{.Status.ContainerStatus.ContainerID}}' "$TASK_ID")"
docker logs --since 2m "$CONTAINER_ID" 2>&1 | grep -Eai "process_singleton_posix|browser_lock|Failed to launch|SIGTERM|ERROR" || echo "sem erros criticos nos ultimos 2m"
```

## 5) Rollback rapido

Quando usar:
- deploy novo entrou com erro critico recorrente
- health caiu e nao recupera

Passos:

```bash
cd /opt/zapmass
git fetch --all --prune
git checkout main
git pull --ff-only
git log --oneline -n 5

# escolha o commit estavel anterior e substitua <COMMIT_ESTAVEL>
git checkout <COMMIT_ESTAVEL>
docker build -t zapmass:latest .
docker stack deploy -c docker-stack.yml zapmass --with-registry-auth

# quando terminar o incidente, volte para main
git checkout main
```

Depois rode o bloco de pos-deploy (seção 2).

## 6) Rotina diaria recomendada

- 1x por dia: rodar "Monitoramento rapido (10 segundos)".
- antes de campanha grande: rodar bloco completo de "Pos-deploy (PASS/FAIL automatico)".
- sempre que investigar lock: usar diagnostico por container ativo (seção 3).
