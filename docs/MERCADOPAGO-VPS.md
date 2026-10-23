# Mercado Pago na VPS (produção)

Configuração de **cobrança / assinatura ZapMass Pro** (Checkout Pro, Pix, cartão, débito automático).  
**Não confundir** com chips WhatsApp (Evolution) — isso é outro conjunto de variáveis (`EVOLUTION_*`, sessões).

## Estado esperado (API pública)

Depois de configurar e reiniciar o stack:

```bash
curl -sS https://zap-mass.com/api/billing/mercadopago/status
# {"ok":true,"checkoutAvailable":true,"configured":true,"mode":"production","issue":null}
# issue quando falha: token_missing | token_invalid | token_malformed | back_url | mp_unreachable

curl -sS https://zap-mass.com/api/health | jq .
# mercadopagoConfigured: true
# mercadopagoCheckoutAvailable: true
# mercadopagoWebhookSecretConfigured: true
# mercadopagoMode: "production"
```

`GET /api/webhooks/mercadopago` deve responder `ok` (200) — útil para testar URL no painel MP.

---

## Checklist na VPS (`/opt/zapmass`)

### 1. Credenciais no Mercado Pago

1. Abra [Mercado Pago Developers](https://www.mercadopago.com.br/developers/panel) → sua aplicação → **Credenciais de produção**.
2. Copie o **Access Token** que começa com `APP_USR-` (não use Public Key nem token `TEST-` em produção real).
3. Em **Webhooks** (Suas integrações):
   - **URL:** `https://zap-mass.com/api/webhooks/mercadopago`
   - Eventos: pagamentos, planos/assinaturas (`payment`, `subscription_preapproval`, `subscription_authorized_payment` — conforme o painel permitir).
   - Copie a **assinatura secreta** (vai para `MERCADOPAGO_WEBHOOK_SECRET`).

### 2. Variáveis no `.env` do host

| Variável | Obrigatório | Exemplo / notas |
|----------|-------------|-----------------|
| `MERCADOPAGO_ACCESS_TOKEN` | Sim | `APP_USR-…` (produção) |
| `MERCADOPAGO_WEBHOOK_SECRET` | Sim em produção | Segredo do painel Webhooks |
| `MERCADOPAGO_BACK_URL` | Sim | `https://zap-mass.com` (sem `/` no fim) |
| `PUBLIC_APP_URL` | Recomendado | Mesmo domínio; fallback se `MERCADOPAGO_BACK_URL` vazio |
| `MERCADOPAGO_CHANNEL_TIER_1` … `_5` | Opcional | Preços mensais por canais (1–5) |
| `MERCADOPAGO_CHANNEL_TIER_*_ANNUAL` | Opcional | Preços anuais por tier |
| `MERCADOPAGO_PRICE_MONTHLY` / `_ANNUAL` | Legado | Plano flat; tiers têm prioridade no checkout por canais |

O checkout monta:

- **back_urls** → `MERCADOPAGO_BACK_URL` (ou `PUBLIC_APP_URL`)
- **notification_url** → `{BACK_URL}/api/webhooks/mercadopago`

Em `NODE_ENV=production`, `localhost` nessa URL **bloqueia** o checkout (erro 503 até corrigir).

### 3. Gravar secrets sem commitar no git

Na VPS, **uma linha por variável**, tokens só na sessão SSH:

```bash
cd /opt/zapmass

MERCADOPAGO_ACCESS_TOKEN='APP_USR-SEU_TOKEN_AQUI' \
MERCADOPAGO_WEBHOOK_SECRET='SEU_SEGREDO_WEBHOOK' \
MERCADOPAGO_BACK_URL='https://zap-mass.com' \
PUBLIC_APP_URL='https://zap-mass.com' \
MERCADOPAGO_CHANNEL_TIER_1='149.90' \
MERCADOPAGO_CHANNEL_TIER_2='249.90' \
MERCADOPAGO_CHANNEL_TIER_3='329.90' \
MERCADOPAGO_CHANNEL_TIER_4='399.90' \
MERCADOPAGO_CHANNEL_TIER_5='459.90' \
bash deployment/vps-env-secrets.sh
```

O script:

- Atualiza `/opt/zapmass/.env`
- Espelha o token em `secrets/mercadopago_access_token` (chmod 600)
- Roda `deployment/vps-check-env.sh`

Validar token **antes** do deploy:

```bash
bash deployment/verify-mercadopago-token.sh
```

### 4. Injeção no Docker (Compose / Swarm)

- **Compose:** `env_file: .env` + variáveis `MERCADOPAGO_*` no serviço `zapmass`; volume `./secrets:/run/secrets:ro`.
- **Swarm:** `env_file` **não** basta — o `deployment/vps-deploy.sh` exporta linhas `MERCADOPAGO_*` do `.env` antes do `docker stack deploy`.
- O servidor lê token nesta ordem: ficheiro `/run/secrets/mercadopago_access_token` → `MERCADOPAGO_ACCESS_TOKEN` no ambiente.

### 5. Reiniciar / deploy

```bash
cd /opt/zapmass
bash deployment/manual-pull-deploy.sh
# ou, se só mudou .env:
# docker compose up -d --force-recreate zapmass   # Compose
# bash deployment/manual-pull-deploy.sh           # Swarm (recomendado)
```

### 6. Verificação local na VPS

```bash
bash deployment/vps-check-env.sh
curl -sS http://127.0.0.1:${HOST_PORT:-3001}/api/billing/mercadopago/status
curl -sS http://127.0.0.1:${HOST_PORT:-3001}/api/health
```

Todos os `health.mercadopago*` críticos devem ser `true` para vender.

### 7. Trânsito temporário (não recomendado)

Se o webhook secret ainda não estiver no `.env`, o POST do MP retorna **503**. Só para teste curto:

```bash
MERCADOPAGO_WEBHOOK_ALLOW_UNSIGNED=1 bash deployment/vps-env-secrets.sh
```

Remova assim que `MERCADOPAGO_WEBHOOK_SECRET` estiver definido.

---

## Rotas úteis (referência)

| Método | Rota | Auth |
|--------|------|------|
| GET | `/api/billing/mercadopago/status` | Público |
| GET | `/api/billing/mercadopago/prices` | Público |
| POST | `/api/billing/mercadopago/start` | Bearer Firebase/VPS |
| POST | `/api/webhooks/mercadopago` | Assinatura MP (`x-signature`) |

---

## Problemas comuns

| Sintoma | Causa provável |
|---------|----------------|
| `configured: false` | Token ausente no contentor (.env vazio ou deploy sem export Swarm) |
| `configured: true`, `ok: false` | Token revogado/errado — regenere `APP_USR-` |
| Checkout 503 “BACK_URL” | Falta `MERCADOPAGO_BACK_URL` / `PUBLIC_APP_URL` https |
| Pagou mas não liberou Pro | Webhook URL errada, secret errado, ou MP não alcança a VPS |
| `mercadopagoMode: "test"` | Token `TEST-` no `.env` |

Scripts relacionados: `deployment/vps-env-secrets.sh`, `deployment/vps-check-env.sh`, `deployment/verify-mercadopago-token.sh`, `deployment/vps-finalizar-producao.sh`.
