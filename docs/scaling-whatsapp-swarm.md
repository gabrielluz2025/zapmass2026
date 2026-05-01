# Escalabilidade de sessoes WhatsApp (Swarm agora, K3s-ready)

- `SESSION_COMMAND_CONCURRENCY` (default `3`): no `wa-worker`, até N comandos pesados (ex.: novo QR, reconnect) em paralelo.
  Evita que um utilizador trave todos os outros; subir só se o host tiver RAM para vários Chromium (cada sessão é pesada).

## Componentes
- `api` (`server/server.ts`): autentica usuario, valida escopo de conexao e publica comandos.
- `sessionControlPlane` (`server/sessionControlPlane.ts`): contrato entre API, router e workers.
- `wa-worker` (`server/waWorker.ts`): runtime dedicado para executar comandos de sessao.
- `redis`: barramento (streams), heartbeat e sincronizacao entre processos.
- `prometheus`: coleta de metricas em `/metrics`.

## Variaveis importantes
- `SESSION_PROCESS_MODE=api|worker|monolith`
- `REDIS_URL=redis://redis:6379`
- `WORKER_ID` (opcional; default usa PID)
- `SESSION_WORKER_LEASE_MS` (lease de roteamento)
- `SESSION_COMMAND_CONCURRENCY` (opcional; ver nota no topo)

## Split API + worker (fase 1)

Defina no `.env` da VPS (exportado pelo deploy para o `docker stack deploy`):

- `ZAPMASS_API_SESSION_MODE=api`
- `WA_WORKER_REPLICAS=1` (ou mais; com cuidado no mesmo volume)

O `docker-stack.yml` passa `SESSION_PROCESS_MODE=${ZAPMASS_API_SESSION_MODE:-monolith}` ao serviço `api`.
Com `api`, o `whatsappService.init()` **não** chama `initializeClient` (sem Chromium no contentor da API)
e sincroniza a lista de canais a partir de `data/connections.json` (escrito pelo worker). **Redis é obrigatório**
para o barramento de comandos entre processos.

Comandos já roteados pelo bus (create, reconnect, QR, send, media, **delete**) executam no `wa-worker`.

**Limitações conhecidas** em `api` + worker: conversas em memória, campanhas, aquecimento e outras rotas que ainda
chamam `waService` direto no `server.ts` podem não refletir o worker — para produção “completa”, use **monolith**
até uma fase 2 (sincronização de estado ou mais comandos).

**Nunca** use `ZAPMASS_API_SESSION_MODE=api` com `WA_WORKER_REPLICAS=0` (API sem quem execute sessão).

Com **monolith** (`ZAPMASS_API_SESSION_MODE` omitido ou `monolith`), mantenha `WA_WORKER_REPLICAS=0` para não haver
dois processos a abrir o mesmo volume de sessão.

A imagem Docker inclui `tini` como PID 1 para melhor reaping de processos defuntos do Chromium.

## Operacao em Swarm
1. Inicializar swarm: `docker swarm init` (apenas uma vez no manager).
2. Build local da imagem: `docker build -t zapmass:latest .`.
3. Deploy da stack: `docker stack deploy -c docker-stack.yml zapmass`.
4. Conferir servicos: `docker stack services zapmass`.
5. Verificar saude:
   - `curl http://127.0.0.1:3001/api/health`
   - `curl http://127.0.0.1:3001/api/session-router/metrics`
   - `curl http://127.0.0.1:3001/metrics`

## Rollout seguro
- `docker-stack.yml` usa `update_config.order=start-first` para reduzir indisponibilidade.
- `stop_grace_period` permanece importante para flush de sessao.
- Em deploy automatico, habilite `SWARM_ENABLED=1` na VPS para usar `docker stack deploy`.

## Checklist K3s-ready
- Contratos de comando/evento ja desacoplados (`sessionContracts`).
- Router sem dependencia de Socket.IO.
- Worker com processo dedicado (`waWorker`) pronto para virar Deployment.
- Redis externo ja preparado para StatefulSet no K3s.
