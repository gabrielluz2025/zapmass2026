-- Lista negra global de opt-out por tenant (inbound + manual)

CREATE TABLE IF NOT EXISTS zapmass.contact_opt_outs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  phone_digits TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone_digits)
);

CREATE INDEX IF NOT EXISTS idx_contact_opt_outs_tenant
  ON zapmass.contact_opt_outs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_opt_outs_phone_suffix
  ON zapmass.contact_opt_outs (tenant_id, right(regexp_replace(phone_digits, '\D', '', 'g'), 8));
