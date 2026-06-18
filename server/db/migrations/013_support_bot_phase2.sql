-- Fase 2: histórico de handoffs do bot de atendimento

CREATE TABLE IF NOT EXISTS zapmass.support_bot_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL,
  phone_digits TEXT NOT NULL,
  conversation_id TEXT NOT NULL DEFAULT '',
  preview_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_bot_handoffs_tenant_created
  ON zapmass.support_bot_handoffs (tenant_id, created_at DESC);
