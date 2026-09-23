-- Identidade do contato por tenant + telefone (independente do chip).

CREATE TABLE IF NOT EXISTS zapmass.contact_identity (
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  phone_digits TEXT NOT NULL,
  preferred_connection_id TEXT,
  last_campaign_id UUID,
  lead_score INT NOT NULL DEFAULT 0,
  lead_band TEXT NOT NULL DEFAULT 'cold',
  reply_flow_state JSONB,
  last_event_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, phone_digits),
  CONSTRAINT contact_identity_lead_band_chk
    CHECK (lead_band IN ('cold', 'warm', 'hot', 'blocked'))
);

CREATE INDEX IF NOT EXISTS idx_contact_identity_tenant_updated
  ON zapmass.contact_identity (tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_identity_phone_suffix
  ON zapmass.contact_identity (tenant_id, right(regexp_replace(phone_digits, '\D', '', 'g'), 8));

CREATE TABLE IF NOT EXISTS zapmass.contact_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  phone_digits TEXT NOT NULL,
  kind TEXT NOT NULL,
  connection_id TEXT,
  campaign_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_events_tenant_phone_created
  ON zapmass.contact_events (tenant_id, phone_digits, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_events_kind
  ON zapmass.contact_events (tenant_id, kind, created_at DESC);
