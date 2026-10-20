# Auditoria pré-lançamento — ZapMass

**Data:** 20/10/2026  
**Versão auditada:** 2.3.315+  
**Escopo:** auth VPS, billing Mercado Pago, campanhas/envio, UI/UX pós-login, operações VPS.

---

## Resumo executivo

O ZapMass está **pronto para lançamento controlado** com auth 100% VPS, Postgres como fonte de dados principal e billing via Mercado Pago. Os riscos mais críticos antes do go-live eram **falso hard gate de onboarding** (assinatura ainda carregando ou API indisponível), **corrida de refresh de token** entre abas/requisições, **500 não tratados** em rotas de auth e **rate limit agressivo** no webhook MP.

**Correções P0 aplicadas nesta release (2.3.315):** gate de assinatura seguro, dedupe de refresh, try/catch 503 nas rotas auth, limite MP webhook ampliado, testes unitários.

**Pendências P2** (não bloqueiam lançamento): observabilidade de webhook MP em dashboard dedicado, testes E2E de checkout, hardening extra de enumeração de e-mail.

---

## Tabelas por prioridade

### Autenticação (VPS + JWT)

| ID | Prioridade | Achado | Impacto | Status |
|----|------------|--------|---------|--------|
| AUTH-01 | **P0** | Hard gate podia aparecer com assinatura ainda em `loading` ou após falha de `/api/subscription` | Cliente pagante vê tela de trial/Pro indevida | **Corrigido** — `subscriptionGateLogic` + `GateOrApp` |
| AUTH-02 | **P0** | Vários `refresh` concorrentes (401 em paralelo, boot + api) | Logout intermitente, rotação excessiva de refresh token | **Corrigido** — dedupe em `vpsRefreshAccessToken` |
| AUTH-03 | **P0** | `login`/`refresh`/`logout`/`me` sem try/catch global | 500 HTML quebra o SPA | **Corrigido** — JSON 503 |
| AUTH-04 | **P1** | Logout numa aba não limpava outra imediatamente | Sessão “fantasma” multi-tab | **Mitigado** — broadcast `localStorage` + listener |
| AUTH-05 | **P2** | Rate limit login/registo adequado; staff invite OK | Abuso brute-force | Aceito — monitorar logs |

### Billing / Mercado Pago

| ID | Prioridade | Achado | Impacto | Status |
|----|------------|--------|---------|--------|
| BILL-01 | **P0** | Webhook MP limitado a 200 req/15 min/IP | Retentativas MP → 429 → assinatura não atualiza | **Corrigido** — 800/15 min + doc |
| BILL-02 | **P1** | Admin sem aviso claro quando MP não configurado | Suporte e churn no checkout | **Corrigido** — banner em Minha assinatura (admin) |
| BILL-03 | **P1** | Checklist MP na VPS incompleto (webhook secret) | Pagamentos sem reconciliação | **Corrigido** — `vps-check-env.sh` |
| BILL-04 | **P2** | Assinatura webhook em produção sem secret | Spoofing teórico de eventos | Configurar `MERCADOPAGO_WEBHOOK_SECRET` |
| BILL-05 | **P2** | Firestore ainda usado em partes legadas de subscription | Divergência VPS/Firestore em migração | Roadmap VPS-only |

### Campanhas e envio

| ID | Prioridade | Achado | Impacto | Status |
|----|------------|--------|---------|--------|
| CAMP-01 | **P1** | Enforcement de plano no servidor (`subscriptionAccess`) | Cliente read-only no front ainda pode tentar API | **OK** — servidor valida |
| CAMP-02 | **P2** | Campanhas grandes + Evolution multi-shard | Latência QR/sync | Runbooks existentes em `deployment/` |
| CAMP-03 | **P2** | LGPD / opt-out | Compliance operacional | Texto no Hard Gate + Configurações |

### UI / UX

| ID | Prioridade | Achado | Impacto | Status |
|----|------------|--------|---------|--------|
| UI-01 | **P1** | Dashboard sem dica quando 0 canais | Onboarding lento | **Corrigido** — link “conecte WhatsApp” |
| UI-02 | **P1** | Spinner 14s `forceEnter` podia combinar com gate | Confusão | **Mitigado** — gate só com `subscriptionGateReady` |
| UI-03 | **P2** | Empty states em Contatos/Campanhas | Curva de aprendizado | Melhorias incrementais |

### Operações / VPS

| ID | Prioridade | Achado | Impacto | Status |
|----|------------|--------|---------|--------|
| OPS-01 | **P0** | Secrets MP/JWT/Postgres fora do repo | Deploy quebrado | **OK** — `.env` + secrets |
| OPS-02 | **P1** | Health `/api/health` + versão | Deploy cego | **OK** — `vps-check-env.sh` |
| OPS-03 | **P2** | Backup Postgres cron | Perda de dados | Scripts em `deployment/backup-postgres*.sh` |

---

## Checklist billing na VPS (sem segredos)

Execute na VPS (`/opt/zapmass`):

```bash
bash deployment/vps-check-env.sh
```

| Variável | Obrigatório | Onde obter |
|----------|-------------|------------|
| `MERCADOPAGO_ACCESS_TOKEN` | Sim (checkout) | [Mercado Pago Developers](https://www.mercadopago.com.br/developers) → sua aplicação → Credenciais de produção → `APP_USR-…` |
| `MERCADOPAGO_BACK_URL` | Recomendado | URL pública do app (ex.: `https://zap-mass.com`) — usada em `back_urls` e montagem do webhook |
| `MERCADOPAGO_WEBHOOK_SECRET` | Produção | MP → Webhooks → assinatura secreta (validação `x-signature`) |
| `MERCADOPAGO_CHANNEL_TIER_1` … | Opcional | IDs de plano/preapproval por tier; defaults em código se vazio |
| `VITE_ENFORCE_SUBSCRIPTION` | Prod | `true` no build de produção |
| `ZAPMASS_JWT_SECRET` | Sim (auth VPS) | Gerar string longa aleatória — **nunca commitar** |
| `ZAPMASS_DATABASE_URL` | Sim | Postgres ZapMass |

**Webhook público:** `POST https://<seu-dominio>/api/webhooks/mercadopago`  
**Teste rápido (sem expor token):** `GET https://<dominio>/api/billing/mercadopago/status` → `{ "checkoutAvailable": true }`

Após alterar `.env`:

```bash
bash deployment/manual-pull-deploy.sh
# ou fluxo CI noturno / Run workflow
```

---

## Recomendações de UI (pós-lançamento)

1. **Primeiro login:** manter Hard Gate como boas-vindas; garantir que trial auto-start respeita `enforce`.
2. **Dashboard:** destacar funil vazio com CTA único (campanha + canal) — parcialmente feito com hint de canais.
3. **Minha assinatura:** estados `past_due` e cancelado com período restante — copy já alinhada ao servidor.
4. **Admin:** Painel Ops já expõe MP; reforçar alerta Discord quando `checkoutAvailable: false`.
5. **Mobile:** sidebar recolhida — validar touch nos CTAs de campanha.

---

## Testes recomendados antes do tráfego real

- [ ] Login → aguardar spinner → **não** ver Hard Gate se já existe assinatura ativa no Postgres/Firestore.
- [ ] Simular falha de rede em `/api/subscription` (DevTools offline) → entrar no app sem Hard Gate; banner/read-only conforme política.
- [ ] Checkout Pix teste (credencial TEST) em homolog.
- [ ] Webhook MP de teste → status `active` no doc de subscription.
- [ ] Logout em duas abas abertas → segunda aba perde sessão em ≤1 evento storage.
- [ ] `npm run test` + `npm run typecheck` verdes no CI.

---

## Referências no código

- Gate assinatura: `src/utils/subscriptionGateLogic.ts`, `src/context/SubscriptionContext.tsx`, `src/App.tsx`
- Refresh dedupe: `src/services/vpsAuth.ts`
- Auth API: `server/vpsAuthRoutes.ts`
- Rate limit MP: `server/httpRateLimit.ts`
- Webhook: `server/subscriptionWebhooks.ts`
