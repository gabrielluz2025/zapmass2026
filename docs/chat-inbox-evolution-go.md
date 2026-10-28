# Bate-papo (Evolution Go) — referências

- Evolution Go — Webhooks: https://docs.evolutionfoundation.com.br/en/evolution-go/webhooks
- Evolution Go — Eventos (wiki): https://github.com/evolution-foundation/evolution-go/blob/main/docs/wiki/recursos-avancados/events-system.md
- Evolution API — Webhooks (v2, `MESSAGES_UPSERT`): https://docs.evolutionfoundation.com.br/en/evolution-api/configuration/webhooks
- whatsmeow — LID store (`GetPNForLID` / `GetLIDForPN`): https://github.com/tulir/whatsmeow/blob/master/store/store.go
- whatsmeow — History sync / LID migration: https://github.com/tulir/whatsmeow/blob/main/message.go
- whatsmeow — History sync on demand (discussion): https://github.com/tulir/whatsmeow/discussions/904
- whatsmeow — Inbox no app (discussion): https://github.com/tulir/whatsmeow/discussions/692
- Meta — WhatsApp overview: https://developers.facebook.com/docs/whatsapp/overview

Variáveis ZapMass (opcional):

- `GO_WEBHOOK_INBOX_STALE_HOURS` — horas sem evento de inbox antes de re-registrar webhook (padrão 6).
- `GO_WEBHOOK_OPEN_GRACE_MINUTES` — grace após chip `open` sem exigir mensagem (padrão 45).
- `GO_WEBHOOK_REPAIR_GRACE_MINUTES` — após reaplicar webhook, UI fica em “aguardando” (padrão 90) em vez de loop “reparando”.
- `GO_BOOTSTRAP_CHAT_MESSAGES` — padrão `1`: ao abrir conversa vazia, tenta `findMessages` no Go e grava no arquivo.
- **`ZAPMASS_WEBHOOK_URL`** — deve ser **alcançável pelo container Evolution** (Swarm: `http://api:3001/webhook/evolution`, não URL HTTPS pública se o Go não sair à internet).

### Checklist webhook (VPS)

1. `.env`: `ZAPMASS_WEBHOOK_URL=http://api:3001/webhook/evolution` (nome do serviço na mesma rede Docker que `evolution`).
2. `docker compose config | grep -i webhook` — Evolution e API com a mesma URL.
3. `bash deployment/diagnose-evolution-chat.sh` — bloco “Teste HTTP do container evolution → webhook”.
4. Logs: `docker logs zapmass-api 2>&1 | grep -E 'MESSAGES_UPSERT|Webhook Go aplicado|webhook.*Timeout'`.
5. API: `GET /api/tenant/inbox-webhook-health` — `lastInboxWebhookAt` deve atualizar ao receber mensagem de teste.

## Histórico ao abrir conversa (Go)

Com `WA_FULL_INBOX_SYNC=0`, a Evolution Go **não** expõe `findMessages` — o histórico vem do **arquivo Postgres** (`wa_chat_messages`) e webhooks.

Ao selecionar um chat, o ZapMass:

1. Hidrata o arquivo (`hydrate-firestore-chat-archive`) com chaves `@lid`, telefone e `waJidAlt`.
2. `load-chat-history` faz merge no servidor, une threads irmãs (@lid + telefone) e faz backfill por todas as chaves de thread.
3. Se o arquivo estiver vazio, **bootstrap** opcional via `findMessages` no Go (`GO_BOOTSTRAP_CHAT_MESSAGES=1`).
4. Só então empty state honesto; **“Sincronizar do celular”** dispara HistorySync — **modo proteção não bloqueia** sync manual (socket), só sync automático.

### Importação do celular (HistorySync) vs arquivo

- **Arquivo Postgres** é mostrado **imediatamente** ao abrir a conversa (auto-load silencioso, sem spinner central).
- **HistorySync** (whatsmeow) é **opcional e em segundo plano**: o chip reconecta, webhooks `HistorySync` trazem stubs/mensagens; o sinal de conclusão é `OfflineSyncCompleted` (Evolution Go).
- A UI de “importando” tem **TTL de 3 minutos** (igual ao lock inflight no servidor). Se expirar, aparece **Tentar de novo** — o histórico já salvo no servidor continua visível.
- O servidor **não** liga `history-sync-status: importing` só porque a inbox está “sparse”; só quando um reconnect/HistorySync inflight está ativo.

**Diagnóstico VPS (logs):**

```bash
docker logs zapmass-api 2>&1 | grep -E 'history-import-ui|Go inbox history sync|loadChatHistory/go|OfflineSyncCompleted'
```

**API:** `GET /api/tenant/ops-health` → `goHistorySync.inflightConnections` (restarts HistorySync ativos por tenant).
