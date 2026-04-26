# RUNBOOK INCIDENTE (DETALHADO)

## 1) Triagem inicial

Objetivo: confirmar se o problema e real ou ruido de log.

```bash
docker service ps zapmass_api
curl -fsS http://127.0.0.1:3001/api/health && echo
curl -fsS http://127.0.0.1:3001/api/session-router/metrics && echo
```

Interpretacao:
- `status: ok` e `aliveWorkers: 1` indicam API e roteador saudaveis.
- `docker service logs` pode mostrar ruido de tasks antigas (`incomplete log stream`).

## 2) Coleta limpa de logs (somente task ativa)

```bash
TASK_ID="$(docker service ps --no-trunc --filter desired-state=running -q zapmass_api | head -n 1)"
CONTAINER_ID="$(docker inspect -f '{{.Status.ContainerStatus.ContainerID}}' "$TASK_ID")"
docker logs --since 5m --tail 400 "$CONTAINER_ID"
```

Filtro para erro critico:

```bash
docker logs --since 5m "$CONTAINER_ID" 2>&1 | grep -Eai "process_singleton_posix|browser_lock|Failed to launch|SIGTERM|ERROR" || echo "sem erros criticos"
```

## 3) Cenarios e acao

### A) Health OK + sem lock critico recente

Acao:
- manter operacao
- monitorar por mais 10 minutos com janela de 2 minutos

```bash
watch -n 30 'curl -fsS http://127.0.0.1:3001/api/health; echo; curl -fsS http://127.0.0.1:3001/api/session-router/metrics; echo'
```

### B) Lock critico recorrente (`process_singleton_posix` / `browser_lock`)

Acao:
- forcar reciclo da API
- validar novamente no container ativo

```bash
docker service update --force zapmass_api
sleep 20
TASK_ID="$(docker service ps --no-trunc --filter desired-state=running -q zapmass_api | head -n 1)"
CONTAINER_ID="$(docker inspect -f '{{.Status.ContainerStatus.ContainerID}}' "$TASK_ID")"
docker logs --since 2m --tail 200 "$CONTAINER_ID"
```

Se continuar falhando:
- executar rollback rapido (secao 4)

### C) API nao sobe ou health falha

Acao:
- verificar task ativa, status e ultimo erro

```bash
docker service ps zapmass_api
docker service inspect zapmass_api --pretty
```

- em seguida aplicar rollback rapido

## 4) Rollback rapido

```bash
set -euo pipefail
cd /opt/zapmass
git fetch --all --prune
git checkout main
git pull --ff-only
git log --oneline -n 10

# substituir pelo commit estavel conhecido
git checkout <COMMIT_ESTAVEL>
docker build -t zapmass:latest .
docker stack deploy -c docker-stack.yml zapmass --with-registry-auth
```

Validar rollback:

```bash
TASK_ID="$(docker service ps --no-trunc --filter desired-state=running -q zapmass_api | head -n 1)"
CONTAINER_ID="$(docker inspect -f '{{.Status.ContainerStatus.ContainerID}}' "$TASK_ID")"
curl -fsS http://127.0.0.1:3001/api/health && echo
curl -fsS http://127.0.0.1:3001/api/session-router/metrics && echo
docker logs --since 2m --tail 200 "$CONTAINER_ID"
```

Pos-incidente:

```bash
cd /opt/zapmass
git checkout main
```

## 5) Criterio de encerramento do incidente

Encerrar somente se:
- task ativa `Running` e container `healthy`
- `status: ok`
- `aliveWorkers: 1`
- sem lock critico nos ultimos 2-5 minutos

