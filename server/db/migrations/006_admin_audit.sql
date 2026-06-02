CREATE TABLE IF NOT EXISTS zapmass.admin_access_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_tenant_id UUID REFERENCES zapmass.users (id) ON DELETE SET NULL,
  target_email TEXT NOT NULL DEFAULT '',
  admin_subject_id TEXT NOT NULL DEFAULT '',
  admin_email TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT 'update',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_access_audit_created
  ON zapmass.admin_access_audit (created_at DESC);
