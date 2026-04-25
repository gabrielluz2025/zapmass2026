# Escalabilidade de sessoes WhatsApp (Swarm agora, K3s-ready)

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
