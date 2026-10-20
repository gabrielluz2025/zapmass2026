# Auditoria pré-lançamento — ZapMass

**Data:** 20/10/2026 · **Versão auditada/corrigida:** 2.3.315 → **2.3.316**
**Escopo:** auth/sessão, assinatura e Hard Gate, Mercado Pago (checkout + webhooks), enforcement de plano (HTTP/socket/worker), campanhas, shell/UI, erros do servidor, scripts da VPS.

> **Honestidade sobre o que foi validado:** a auditoria foi **por leitura de código + testes automatizados (vitest, typecheck)**. Nada aqui substitui QA manual na VPS com Mercado Pago real/sandbox (ver "O que NÃO foi validado").

---

## 1. Resumo executivo

O núcleo (auth VPS, Postgres, assinatura por tiers, MP) está **estruturalmente pronto**, mas havia falhas que fariam o cliente pagante perder dinheiro/acesso ou deixariam não-pagantes usar o produto:

| Risco | Antes | Depois (2.3.315/316) |
|---|---|---|
| Webhook MP duplicado/retentado | Pagamento podia ser creditado 2× (estender `accessEndsAt` em dobro); 5xx do MP virava "ignorado" e nunca era reprocessado | Idempotência por `paymentId`/`preapproval`; erro transitório → 5xx para o MP **reenviar**; lock por tenant |
| Reembolso / chargeback | Acesso não era revogado | Revogação automática |
| Cancelou o débito automático | Perdia acesso na hora (mesmo com ciclo pago) | Mantém acesso até `accessEndsAt` (servidor **e** cliente) |
| Checkout em produção com `localhost` como back_url | Preferência criada com URL inválida | Falha clara (503) + log no boot |
| Cliente sem plano via API | `redispatch`, `retry-failed`, `test-send`, `nurture/dispatch` enviavam mensagens sem checar plano | Guard HTTP 402 `SUBSCRIPTION_REQUIRED` |
| Plano vence com fila em andamento | Jobs BullMQ já enfileirados continuavam enviando | Job entra em *hold* (não perde a fila); volta ao renovar |
| Plano vencido e quer parar | `pause-campaign` / `stop-auto-warmup` exigiam assinatura (não conseguia parar!) | Parar/pausar nunca exige plano |
| Funcionário demitido | Refresh token valia até 30 dias; JWT 8h sem recheck | Refresh recusado; acesso cai em ≤60s; tokens revogados |
| Duas abas renovando sessão | 2ª aba levava 401 → logout | Janela de tolerância de 20s na rotação do refresh |
| Soluço 5xx no `/auth/refresh` | Cliente apagava a sessão local | Só 401/403 limpam sessão |
| Rejeição em rota `async` (Express 4) | Requisição **pendurada** até timeout + só log | JSON 500 genérico; body-parser 400/413 em JSON |
| `/api/health` `mercadopagoConfigured:false` | Timeout da API do MP virava "não configurado" (falso negativo) | `configured` = token local; novos campos de diagnóstico |
| Staff via `/api/subscription` | Via `adminNote`, ids internos do MP | Payload sanitizado (owner e staff) |
| Hard Gate | Aparecia com assinatura carregando/falha de rede | Fail-open + gate só com assinatura carregada |

**Veredito:** pronto para **venda controlada** *depois* de executar o checklist da seção 5 e o QA manual da seção 6. Não recomendo tráfego pago em massa antes de um pagamento real ponta a ponta na VPS.

---

## 2. Tabela P0 / P1 / P2

Esforço: **S** < 2h · **M** 2–8h · **L** > 1 dia. Status: ✅ corrigido · 🟡 mitigado · ⬜ pendente.

### P0 — bloqueia venda

| Área | Problema | Solução | Esforço | Status |
|---|---|---|---|---|
| MP webhook | Pagamento processado 2× em retentativa | `server/subscriptionIdempotency.ts` (ids processados, últimos 30) + `withTenantLock` | M | ✅ |
| MP webhook | Falha transitória do MP engolida (nunca reprocessava) | `mpGetJson` lança em 5xx/429/401/403 → webhook responde 5xx | M | ✅ |
| MP webhook | Reembolso/chargeback não revogava acesso | Revogação em `applyMercadoPagoPayment` | S | ✅ |
| MP webhook | IPN legado (`?topic=&id=`) e `authorized_payment` ignorados | `processMercadoPagoBody` aceita query + tópico | M | ✅ |
| MP webhook | Rate limit 200/15min derrubava retentativas | 800/15min | S | ✅ |
| Billing | `back_url` localhost em produção | `server/mercadoPagoBackUrl.ts` (`assertMercadoPagoBackUrlForCheckout`) | S | ✅ |
| Assinatura | `canceled` perdia acesso do ciclo pago | `userHasFullAppAccess` (server+client) | S | ✅ |
| Enforcement | HTTP de envio sem checagem de plano | `server/httpSubscriptionGuard.ts` em `redispatch`, `retry-failed`, `test-send`, `nurture/dispatch` | S | ✅ |
| Enforcement | Fila já enfileirada seguia após vencer | `ownerMaySendCampaignJobs` no worker (`evolutionService.ts`), hold 120s, cache 60s, fail-open | M | ✅ |
| Hard Gate | Gate indevido p/ pagante | `subscriptionGateLogic.ts` (v2.3.315) | M | ✅ |
| Auth | Logout intermitente (refresh concorrente) | Dedupe no cliente + grace 20s no servidor | M | ✅ |
| Auth | Rotas auth com 500 HTML | try/catch → JSON 503 | S | ✅ |

### P1 — corrigir antes de escalar

| Área | Problema | Solução | Esforço | Status |
|---|---|---|---|---|
| Autorização | Funcionário revogado mantinha acesso | `isStaffMemberActive` (cache 60s) em `resolveAuth` + checagem fresca no refresh + revogação de tokens | M | ✅ |
| Auth | Reset de senha deixava refresh válido por 20s (efeito do grace) | Reset/logout usam revogação **imediata** | S | ✅ |
| Auth | 5xx no refresh apagava sessão | `vpsAuth.ts` só limpa em 401/403 | S | ✅ |
| Servidor | Async handler sem catch (Express 4) | `server/expressAsyncSafe.ts` + middleware JSON final + teste | M | ✅ |
| Privacidade | `/api/subscription` vazava campos internos | `subscriptionToClient` (owner/staff) | S | ✅ |
| Staff | Funcionário caía no HardGate | Vê assinatura do tenant, read-only | S | ✅ |
| Socket | Pausar/parar exigia plano | Removido de `pause-campaign`/`stop-auto-warmup` | S | ✅ |
| Health | Falso "MP não configurado" | `configured` local + `mercadopagoWebhookSecretConfigured`, `subscriptionEnforced`, `mercadopagoCheckoutVerified`; timeout 8s no `/users/me` | S | ✅ |
| VPS | `vps-check-env.sh` marcava Firebase como FALTA em modo VPS puro; não acusava `SUBSCRIPTION_ENFORCE=0` nem back URL inválida | Script atualizado + leitura dos campos do `/api/health` | S | ✅ |
| UI | Menu da conta sem ESC/aria, sem atalho p/ assinatura; gaveta mobile mostrava só ícones se desktop estava recolhido | `TopBar`/`Sidebar` ajustados (ESC, `aria-*`, "Minha assinatura", gaveta sempre expandida) | S | ✅ |
| Billing | Lock de tenant é **em memória** (1 réplica) | Se escalar p/ >1 réplica: `pg_advisory_xact_lock` | M | ⬜ |
| Billing | Formato real de `external_reference` em pagamentos de preapproval no MP | Validar em sandbox (seção 6) | S | ⬜ |

### P2 — pós-lançamento

| Área | Problema | Solução | Esforço |
|---|---|---|---|
| Teste | Sem E2E de checkout/webhook (só unit) | Playwright + MP sandbox + webhook simulado | L |
| Auth | Troca de senha logado talvez não revogue refresh tokens (não auditado a fundo) | Revisar `vpsProfileRoutes` e usar revogação imediata | S |
| Observabilidade | Falha de webhook MP só em log | Alerta Discord quando `checkoutAvailable:false` ou 5xx repetido | M |
| Billing | Firestore legado ainda em partes de subscription | Migração VPS-only | L |
| Rate limit | `trust proxy`/limiters por IP atrás de CDN | Conferir IP real | S |
| UI | Upgrade/latência ocultos < `lg` na TopBar | CTA de plano visível no mobile | S |
| UI | Empty states (Contatos/Campanhas) | Incremental | M |
| Evolution | Edge cases (QR/sync multi-shard) | Runbooks já em `deployment/` | — |

---

## 3. Recomendações de UI/UX

1. **Mobile:** o botão "Upgrade" e a latência ficam escondidos abaixo de `lg`; o item "Minha assinatura" no menu da conta agora cobre o caso, mas vale um CTA fixo p/ trial expirando.
2. **Estados de assinatura:** mostrar na tela "Minha assinatura" o texto *"Acesso até DD/MM"* para `canceled` com período restante (regra já existe no servidor).
3. **Erro 402:** o front deve tratar `code: "SUBSCRIPTION_REQUIRED"` (HTTP) como o evento de socket `subscription-required` (abrir modal de upgrade).
4. **Primeiro login:** Hard Gate como boas-vindas; testar fluxo com trial automático.
5. **Acessibilidade:** continuar a varredura (foco visível, contraste no tema escuro, `aria-live` em toasts). Só foram auditados Sidebar/TopBar/AppShell.
6. **Mensagens de erro:** nunca expor texto técnico — o middleware final já devolve mensagem genérica.

---

## 4. O que NÃO foi validado (exige QA manual)

- **Pagamento real/sandbox ponta a ponta** (Pix, cartão, assinatura recorrente, upgrade de tier, reembolso) e e-mail transacional (Resend).
- **Formato real** dos eventos do MP: se `payment` de preapproval traz `external_reference`; formato de `/authorized_payments/{id}`.
- **Comportamento na VPS** (Docker, Nginx, certificados, cron de deploy 02–06h BRT).
- **Multi-réplica:** lock de tenant só em processo.
- **Não auditados a fundo:** importação/mapa de contatos, Chat, internals de warmup, Creator Studio/Admin, agentes/IA, `evolutionService` além do portão de assinatura, cobertura de TODO/FIXME em caminhos críticos.
- **Testes automatizados** cobrem só helpers puros e o middleware Express; **não** há teste de integração com Postgres/Redis/MP.

---

## 5. Checklist de go-live de billing (VPS) — sem segredos

Na VPS (`/opt/zapmass`): `bash deployment/vps-check-env.sh` (agora também lê `/api/health`).

| Variável | Obrigatória | Observação |
|---|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | Sim | Credenciais **de produção** `APP_USR-…` (não `TEST-`) |
| `MERCADOPAGO_WEBHOOK_SECRET` | **Sim em produção** | MP → Webhooks → assinatura secreta. Sem ele o webhook é inseguro. `MERCADOPAGO_WEBHOOK_ALLOW_UNSIGNED` só para homolog |
| `MERCADOPAGO_BACK_URL` / `PUBLIC_APP_URL` | Sim | `https://` público, **nunca** localhost (checkout recusa) |
| `MERCADOPAGO_CHANNEL_TIER_*` | Opcional | Defaults em `shared/channelTierPricing` |
| `SUBSCRIPTION_ENFORCE` | Não definir (ou `1`) | `0` libera o produto sem pagar |
| `VITE_ENFORCE_SUBSCRIPTION` | `true` (build arg) | Exige **rebuild** da imagem |
| `ZAPMASS_JWT_SECRET` | Sim | Longo e aleatório; nunca commitar |
| `ZAPMASS_DATABASE_URL`, `ZAPMASS_AUTH_PROVIDER=vps`, `ZAPMASS_DATA_PROVIDER=vps` | Sim | Modo VPS puro |
| `RESEND_API_KEY`, `EMAIL_FROM` | Sim | Reset de senha e avisos |

**Painel do Mercado Pago**
- [ ] Webhook de produção: `https://<dominio>/api/webhooks/mercadopago` com eventos `payment`, `subscription_preapproval` e `subscription_authorized_payment`.
- [ ] Segredo do painel == `MERCADOPAGO_WEBHOOK_SECRET`.

**Verificação pós-deploy** (`GET /api/health`):
`mercadopagoConfigured: true`, `mercadopagoCheckoutAvailable: true`, `mercadopagoCheckoutVerified: true`, `mercadopagoWebhookSecretConfigured: true`, `subscriptionEnforced: true`, `emailConfigured: true`.

Deploy: push em `main` valida build/testes; o deploy na VPS roda na janela 02–06h BRT ou via *Run workflow* manual.

---

## 6. Roteiro de QA manual antes de vender

1. Conta nova → trial → ver Hard Gate/onboarding corretos.
2. Checkout Pix real de menor valor → webhook → `status: active` e `accessEndsAt` correto; reenviar o mesmo webhook (painel MP) → **não** estende de novo.
3. Assinatura recorrente + cancelar → acesso continua até o fim do ciclo.
4. Reembolso de teste → acesso revogado.
5. Conta sem plano: tentar `POST /api/campaigns/:id/redispatch` → **402**; pausar campanha em andamento → funciona.
6. Plano vencendo com campanha rodando → jobs ficam em hold e voltam após renovar.
7. Remover funcionário logado em outra aba → em ≤60s as chamadas dele falham (401).
8. Duas abas abertas, esperar token expirar → ambas continuam logadas; logout em uma desloga a outra.
9. Derrubar o Postgres por alguns segundos → app não desloga clientes; recupera sozinho.
10. `bash deployment/vps-check-env.sh` sem `FALTA`.

---

## 7. Referências no código

- Webhook/idempotência: `server/subscriptionWebhooks.ts`, `server/subscriptionIdempotency.ts`, `server/mercadoPagoBackUrl.ts`
- Acesso: `server/subscriptionAccess.ts`, `src/context/SubscriptionContext.tsx`, `src/utils/subscriptionGateLogic.ts`
- Guard HTTP / worker: `server/httpSubscriptionGuard.ts`, `server/evolutionService.ts` (`ownerMaySendCampaignJobs`)
- Auth: `server/vpsAuthRoutes.ts`, `server/auth/userRepository.ts`, `server/auth/staffRepository.ts`, `src/services/vpsAuth.ts`
- Erros HTTP: `server/expressAsyncSafe.ts`
- Scripts: `deployment/vps-check-env.sh`
