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
