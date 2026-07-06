-- Legal acceptances, LGPD requests, contact opt-out, suggestion status

CREATE TABLE IF NOT EXISTS zapmass.legal_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  actor_subject_id TEXT NOT NULL DEFAULT '',
  doc_type TEXT NOT NULL DEFAULT 'whatsapp_risk',
  doc_version TEXT NOT NULL DEFAULT '',
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_tenant
  ON zapmass.legal_acceptances (tenant_id, doc_type, accepted_at DESC);

CREATE TABLE IF NOT EXISTS zapmass.data_privacy_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  actor_subject_id TEXT NOT NULL DEFAULT '',
  request_type TEXT NOT NULL CHECK (request_type IN ('export', 'deletion')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'rejected')),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_privacy_requests_tenant
  ON zapmass.data_privacy_requests (tenant_id, created_at DESC);

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

ALTER TABLE zapmass.product_suggestions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'received';

ALTER TABLE zapmass.product_suggestions
  ADD COLUMN IF NOT EXISTS admin_note TEXT NOT NULL DEFAULT '';

ALTER TABLE zapmass.product_suggestions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS zapmass.renewal_reminder_log (
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  access_ends_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, access_ends_at)
);
