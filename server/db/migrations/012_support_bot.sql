-- Atendimento automático (bot menu + handoff humano)

CREATE TABLE IF NOT EXISTS zapmass.tenant_support_bot (
  tenant_id UUID PRIMARY KEY REFERENCES zapmass.users (id) ON DELETE CASCADE,
  doc JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zapmass.support_bot_sessions (
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL,
  phone_digits TEXT NOT NULL,
  conversation_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'menu',
  last_menu_sent_at TIMESTAMPTZ,
  handed_off_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, connection_id, phone_digits)
);

CREATE INDEX IF NOT EXISTS idx_support_bot_sessions_tenant_state
  ON zapmass.support_bot_sessions (tenant_id, state);

CREATE TABLE IF NOT EXISTS zapmass.support_bot_metrics (
  tenant_id UUID PRIMARY KEY REFERENCES zapmass.users (id) ON DELETE CASCADE,
  bot_replies INT NOT NULL DEFAULT 0,
  handoffs INT NOT NULL DEFAULT 0,
  menu_shown INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
