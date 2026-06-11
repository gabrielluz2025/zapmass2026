-- Motor multi-etapas persistente: rastreia a posição de cada contato no fluxo.
-- Suporta trigger_type: immediate | delay | any_reply | conditional
-- Retrocompatível: campanhas sem stageConfigs continuam funcionando via BullMQ puro.

CREATE TABLE IF NOT EXISTS zapmass.campaign_contact_state (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID        NOT NULL REFERENCES zapmass.campaigns(id) ON DELETE CASCADE,
  contact_id     TEXT        NOT NULL,   -- telefone normalizado (apenas dígitos)
  tenant_id      UUID        NOT NULL REFERENCES zapmass.users(id) ON DELETE CASCADE,
  current_step_index INTEGER NOT NULL DEFAULT 0,
  status         TEXT        NOT NULL DEFAULT 'pending',
  -- pending | waiting_reply | waiting_delay | completed | failed | skipped
  step_entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  attempts       INTEGER     NOT NULL DEFAULT 0,
  error_message  TEXT,
  reply_received_at TIMESTAMPTZ,
  reply_text     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_ccs_campaign
  ON zapmass.campaign_contact_state(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ccs_tenant
  ON zapmass.campaign_contact_state(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ccs_status
  ON zapmass.campaign_contact_state(status);
CREATE INDEX IF NOT EXISTS idx_ccs_step_entered
  ON zapmass.campaign_contact_state(step_entered_at);
CREATE INDEX IF NOT EXISTS idx_ccs_waiting_reply
  ON zapmass.campaign_contact_state(campaign_id, status)
  WHERE status = 'waiting_reply';
