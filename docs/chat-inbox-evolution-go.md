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

## Histórico ao abrir conversa (Go)

Com `WA_FULL_INBOX_SYNC=0`, a Evolution Go **não** expõe `findMessages` — o histórico vem do **arquivo Postgres** (`wa_chat_messages`) e webhooks.

Ao selecionar um chat, o ZapMass:

1. Hidrata o arquivo (`hydrate-firestore-chat-archive`) com chaves `@lid`, telefone e `waJidAlt`.
2. `load-chat-history` faz merge no servidor, une threads irmãs (@lid + telefone) e faz backfill por todas as chaves de thread.
3. Só então mostra empty state honesto; **“Sincronizar do celular”** dispara HistorySync (pode ser enfileirado em modo proteção).
