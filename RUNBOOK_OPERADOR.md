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

## 502 Bad Gateway no browser (Nginx ok, backend morto)

O Nginx responde, mas **`proxy_pass` para a API** não recebe HTTP 200 — em geral o contentor **`zapmass_api`** está a reiniciar ou nem escuta na porta publicada (`HOST_PORT`, por defeito **3001**).

1. **Confirme o código na VPS** — o `Dockerfile` tem de copiar **`shared/`** para a imagem (commit `c18c3fb` ou mais recente). Sem isso o Node rebenta ao importar `channelTierPricing` e o site fica em 502.
2. Na VPS (SSH):

```bash
# API a escutar?
curl -sS -o /dev/null -w "HTTP %{http_code}\n" "http://127.0.0.1:${HOST_PORT:-3001}/api/health" || echo "curl falhou"

docker service ps zapmass_api --no-trunc
docker service logs zapmass_api --tail 120
```

3. Procure nos logs por **`Cannot find module`**, **`ERR_MODULE_NOT_FOUND`**, **`shared/channelTierPricing`**. Se aparecer: `cd /opt/zapmass && git pull` (ou checkout do commit certo) e **`bash deployment/vps-deploy.sh`** ou o workflow **Re-run** no GitHub.
4. Se o health local for 200 mas o site público continuar 502: confira o **server block** do Nginx (`proxy_pass` deve apontar para a mesma porta que o Docker publica no host).

## Cobrança (referência rápida)

- Pagamentos no produto são **somente Mercado Pago** (Infinite Pay não existe mais neste código).
- Webhook de pagamentos: **`POST /api/webhooks/mercadopago`** — deve estar configurado no painel do Mercado Pago para a URL pública da API.
- Rotas removidas (não usar em proxies nem integrações antigas): **`/api/webhooks/infinitepay`**, **`POST /api/billing/infinitepay/start`**.

