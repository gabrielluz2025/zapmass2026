CREATE TABLE IF NOT EXISTS zapmass.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  sort_name TEXT NOT NULL DEFAULT '',
  doc JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_sort ON zapmass.contacts (tenant_id, sort_name);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_phone ON zapmass.contacts (tenant_id, phone);

CREATE TABLE IF NOT EXISTS zapmass.contact_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  contact_ids JSONB NOT NULL DEFAULT '[]',
  description TEXT,
  tags JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_lists_tenant ON zapmass.contact_lists (tenant_id, created_at DESC);
