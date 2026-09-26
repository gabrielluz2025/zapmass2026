-- Persiste a lista de conversas (inbox) para sobreviver a restarts do servidor.
-- Complementa wa_chat_threads (que guarda mensagens) com metadados de exibição.
CREATE TABLE IF NOT EXISTS zapmass.wa_inbox_conversations (
  tenant_id       UUID    NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  conversation_id TEXT    NOT NULL,
  connection_id   TEXT    NOT NULL DEFAULT '',
  contact_name    TEXT    NOT NULL DEFAULT '',
  contact_phone   TEXT    NOT NULL DEFAULT '',
  last_message    TEXT    NOT NULL DEFAULT '',
  last_msg_ts     BIGINT  NOT NULL DEFAULT 0,
  unread_count    INT     NOT NULL DEFAULT 0,
  tags            TEXT[]  NOT NULL DEFAULT '{}',
  profile_pic_url TEXT,
  deleted         BOOLEAN NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_inbox_conv_tenant_ts
  ON zapmass.wa_inbox_conversations (tenant_id, last_msg_ts DESC)
  WHERE deleted = false;
