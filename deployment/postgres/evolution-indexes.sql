-- Índices evolution_db (Evolution API) — idempotente via IF NOT EXISTS em scripts de deploy.
-- Aplicar em DB existente: bash deployment/vps-optimize-evolution-db.sh

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_instance_timestamp
  ON "Message" ("instanceId", "messageTimestamp");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_remote_jid
  ON "Message" (("key"->>'remoteJid'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_instance_remote_jid_ts
  ON "Message" ("instanceId", ("key"->>'remoteJid'), "messageTimestamp" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_isonwhatsapp_remote_jid
  ON "IsOnWhatsapp" ("remoteJid");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contact_instance_remote_jid
  ON "Contact" ("instanceId", "remoteJid");

ANALYZE "Message";
ANALYZE "IsOnWhatsapp";
ANALYZE "Contact";
ANALYZE "Chat";
