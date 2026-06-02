# Migração Firebase → VPS (ZapMass)

Sem clientes em produção, a migração pode ser feita por fases com testes entre cada etapa.

## Fase 1 — Auth VPS (implementada)

- Postgres `zapmass_db` no mesmo container que `evolution_db`
- Tabelas: `zapmass.users`, `workspace_members`, `refresh_tokens`
- API: `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/auth/me`
- Login funcionário: mesmo endpoint `/api/workspace/staff/sign-in` (resposta `authProvider: vps` + `accessToken`)
- Socket e admin: aceitam JWT ZapMass (`resolveAuth`)

### Ativar localmente

No `.env`:

```env
ZAPMASS_AUTH_PROVIDER=vps
ZAPMASS_JWT_SECRET=gere-uma-string-longa-aleatoria-min-32-chars
ZAPMASS_DATABASE_URL=postgresql://postgres:evolution-secure-pass-2026@localhost:5432/zapmass_db
```

No build do front (`.env` ou docker build args):

```env
VITE_USE_VPS_AUTH=true
```

Subir Postgres (Docker): `docker compose up -d postgres` — na primeira vez cria `zapmass_db`; volumes antigos: migrations da API criam o schema.

### Testar

1. `npm run server:dev:kill` + `VITE_USE_VPS_AUTH=true npm run client:dev:kill` (ou variáveis no `.env`)
2. Registar conta (e-mail/senha) na landing
3. Criar funcionário em Configurações → Equipe
4. Login funcionário na landing

## Fase 2 — Contatos e listas (implementada)

Com `ZAPMASS_AUTH_PROVIDER=vps` (ou `ZAPMASS_DATA_PROVIDER=vps`) e `VITE_USE_VPS_AUTH=true`:

| Recurso | API |
|---------|-----|
| Listar contatos | `GET /api/contacts` |
| Criar / lote | `POST /api/contacts`, `POST /api/contacts/bulk` |
| Atualizar | `PATCH /api/contacts/:id`, `POST /api/contacts/bulk-update` |
| Apagar | `DELETE /api/contacts/:id` |
| Listas | `GET/POST/PATCH/DELETE /api/contact-lists` |
| Limpar tudo (dono) | `DELETE /api/tenant/contacts-data` |

O front (`ZapMassContext`) deixa de usar `onSnapshot` em contatos/listas quando `VITE_USE_VPS_DATA` ou `VITE_USE_VPS_AUTH` está ativo.

**Ainda no Firestore:** campanhas, conversas, assinatura, config, inbox assignments (ver Fases 3–4).

## Fase 3 — Campanhas (implementada)

- Tabelas `zapmass.campaigns` e `zapmass.campaign_logs`
- API: `GET/POST/PATCH/DELETE /api/campaigns`, `GET /api/campaigns/:id/logs`
- Servidor: `campaignStore` (logs, progresso, agendadas, reply flow) usa Postgres quando `ZAPMASS_DATA_PROVIDER=vps`
- Front: listagem, criar, agendar, disparar, pausar, apagar via API (`VITE_USE_VPS_AUTH` ou `VITE_USE_VPS_DATA`)

## Fase 4 — Conversas / chat (implementada)

Com `ZAPMASS_DATA_PROVIDER=vps` (ou auth VPS):

| Recurso | Onde |
|---------|------|
| Arquivo de mensagens (`wa_chat_threads` / `wa_chat_messages`) | Postgres — gravação automática no servidor (Evolution + legado WA) |
| Hidratar arquivo ao abrir chat | Socket `hydrate-firestore-chat-archive` (nome legado; dados vêm do Postgres em modo VPS) |
| Inbox assignments (claim/transfer/release/finish) | Postgres `inbox_assignments` |
| Feedback pós-atendimento inbox | Postgres `inbox_attendance_feedback` |

Conversas **ativas** continuam em RAM no processo da API + tempo real via Evolution/socket (como antes).

## Fase 5 — Plataforma / desligar Firebase (implementada)

Com `ZAPMASS_DATA_PROVIDER=vps`:

| Recurso | Postgres / API |
|---------|----------------|
| Assinatura (`user_subscriptions`) | `GET /api/subscription` + billing/trial/MP/webhooks no servidor |
| Notificações | `GET /api/notifications`, PATCH read, DELETE |
| `app_config` global | Postgres `app_config_global` (GET `/api/app-config` inalterado) |
| Config dispatch (delays, sono) | `tenant_dispatch_settings` (socket `tenant-settings` como antes) |
| Segmento de uso (`app_profile`) | `GET/PUT /api/app-profile` |
| Sugestões de produto | `product_suggestions` + POST `/api/product-suggestion` (JWT VPS) |
| Estatísticas de uso (heartbeat) | `tenant_usage_stats` |
| Workspace equipa | `workspace_members` + JWT (sem `userWorkspaceLinks` no browser) |

O front deixa de usar `onSnapshot` em assinatura, notificações e perfil quando `VITE_USE_VPS_AUTH` ou `VITE_USE_VPS_DATA`.

**Painel admin (acesso clientes):** `GET /api/admin/access-users`, `PUT /api/admin/access-user` e `GET /api/admin/access-audit` leem/gravam Postgres + tabela `admin_access_audit` em modo VPS.

**Pacotes Firebase:** mantidos para modo legado / admin híbrido; em VPS puro não é obrigatório configurar Firestore para dados de negócio.

**Opcional depois:** remover dependências `firebase` do cliente; OAuth Google/Facebook só se voltar a oferecer login social na VPS.

## Migração de produção (Firestore → Postgres)

Na VPS, com Firebase Admin e Postgres ativos:

```bash
cd /opt/zapmass
bash deployment/vps-migrate-production.sh          # migração real
bash deployment/vps-migrate-production.sh --dry-run # só simular
```

O script:

1. Define `ZAPMASS_AUTH_PROVIDER=dual`, `ZAPMASS_DATA_PROVIDER=vps`, `VITE_USE_VPS_DATA=true` (login Google/Facebook continua).
2. Faz deploy com rebuild do front.
3. Executa `server/migrateFirestoreToVps.ts` (assinatura, contatos, campanhas, chat, inbox, equipa, etc.).
4. Renomeia pastas em `/app/data` de `{firebaseUid}__` para `{uuidPostgres}__` (sessões WhatsApp).

UID Firebase → UUID Postgres é **determinístico** (UUID v5). Webhooks Mercado Pago e login Firebase seguem a funcionar com o mesmo UID na referência externa.

## Modo 100% VPS (sem Firebase)

```bash
cd /opt/zapmass
bash deployment/vps-pure-no-firebase.sh
# Banco zapmass vazio (contas novas):
# ZAPMASS_RESET_DATA=1 bash deployment/vps-pure-no-firebase.sh
```

- `ZAPMASS_AUTH_PROVIDER=vps`, `ZAPMASS_DATA_PROVIDER=vps`
- Login só **e-mail/senha** + funcionários (Equipe)
- `firebase-admin.json` **não é obrigatório**
- Admin plataforma: `ADMIN_EMAILS` no `.env` (e-mail da conta registada na landing)

## Fase 6 — Oracle (futuro)

- SQL portável no core; auth permanece na app/VPS
