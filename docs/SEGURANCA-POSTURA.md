# Postura de segurança — ZapMass (2026)

Contexto: ondas recentes de exploração em **ecossistema PHP** (plugins, cPanel, WordPress) **não se aplicam diretamente** ao ZapMass: a aplicação é **Node.js + Express + Vite**, dados em **PostgreSQL**, deploy em **Docker/nginx** na VPS — **sem runtime PHP** no produto.

## Resumo (3 linhas)

- Superfície web principal: API Node estática + SPA; auth **Google OAuth / e-mail+senha VPS** com JWT + refresh rotacionado; admin por allowlist de e-mail.
- Pagamentos: **Mercado Pago** (webhook assinado quando configurado); WhatsApp: **Evolution API** com webhook opcionalmente autenticado por token.
- Riscos reais a monitorar: **segredos no `.env`**, dependências npm, **SSH/nginx** na VPS — não “CVE de plugin PHP”.

## Stack e exposição

| Camada | Tecnologia | Notas |
|--------|------------|--------|
| App | Node 20+, Express, Socket.IO | Sem PHP/Apache do app |
| Front | Vite/React | CSP no host que serve o SPA (nginx) |
| Dados | PostgreSQL (`zapmass.*`) | Queries parametrizadas (pg) |
| Fila | Redis/BullMQ | Rede interna Docker |
| WA | Evolution Go | Webhook POST para a API |

## Autenticação e autorização

- **Clientes:** sessão VPS (access JWT + refresh com rotação, grace 20s); Google OAuth com rate limit dedicado.
- **Admin (Painel do criador):** `assertAdminFromBearer` — só e-mails na lista de plataforma; rotas `/api/admin/*` não expõem dados sensíveis sem token.
- **Staff:** vínculo por tenant; revogação rechecada no refresh (ver `docs/PRE-LANCAMENTO-AUDITORIA.md`).

## Entradas externas (webhooks e limites)

- **`POST /webhook/evolution`:** rate limit; token Bearer / `X-Evolution-Webhook-Token` quando `EVOLUTION_WEBHOOK_TOKEN` definido; exigência opcional `ZAPMASS_REQUIRE_WEBHOOK_TOKEN=1`.
- **`POST /api/webhooks/mercadopago`:** rate limit elevado para retentativas; validação de assinatura via `MERCADOPAGO_WEBHOOK_SECRET` (recomendado em produção).
- **Auth / reset / registro:** limiters em `server/httpRateLimit.ts`.

## Validação, XSS, CSRF, SQLi

- **SQLi:** acesso Postgres via parâmetros (`$1`, …) nos repositórios VPS.
- **XSS:** React escapa por padrão; textos comerciais sanitizados (`commercialConfigValidation`); evitar `dangerouslySetInnerHTML` em conteúdo de usuário.
- **CSRF:** API stateless com Bearer JWT — navegador não envia cookie de sessão cross-site clássico; manter CORS/origin alinhados ao domínio do produto.
- **Body size:** limite JSON configurável no Express.

## Cabeçalhos HTTP (API)

`server/securityHeaders.ts`: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`. CSP fica no nginx/host do SPA.

## Segredos e deploy

- `.env` / `deployment/*/secrets` — **nunca** commitar; tokens MP, Evolution, JWT, Postgres.
- VPS: preferir SSH com chave, firewall (só 443/80 públicos), containers sem privilégio desnecessário.
- CI: build + testes; deploy noturno ou manual (Actions).

## Dependências (npm audit — resumo)

Executar periodicamente `npm audit`. Transitivos comuns com avisos **high** incluem cadeias **axios**, **@grpc/grpc-js** (Firebase/google), **@fastify/busboy** — avaliar `npm audit fix` em janela de manutenção e regressão de testes; nem todo fix é patch semver-safe.

## Hardening recomendado (backlog acionável)

| Prioridade | Ação |
|------------|------|
| P1 | Garantir `MERCADOPAGO_WEBHOOK_SECRET` + `EVOLUTION_WEBHOOK_TOKEN` + `ZAPMASS_REQUIRE_WEBHOOK_TOKEN=1` em produção |
| P1 | Rotacionar tokens MP/Evolution após incidente ou funcionário com acesso à VPS |
| P2 | HSTS + CSP estritos no **nginx** do domínio público |
| P2 | Lock de billing multi-réplica (`pg_advisory_xact_lock`) se escalar API >1 réplica |
| P2 | Alertas (Discord) para falhas repetidas de webhook / health MP |
| P3 | E2E checkout sandbox; revisão periódica de dependências |

## Mercado Livre

**Não há integração** com API do Mercado Livre (marketplace) neste repositório. Preços/comercial afetam **ZapMass + Mercado Pago** apenas. Anúncios no ML são **manual** (ou futuro backlog separado).

---

Ver também: `docs/PRE-LANCAMENTO-AUDITORIA.md`, `docs/MERCADOPAGO-VPS.md`, `docs/VPS-ENV-PRODUCAO.md`.
