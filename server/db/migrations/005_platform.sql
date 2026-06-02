CREATE TABLE IF NOT EXISTS zapmass.user_subscriptions (
  tenant_id UUID PRIMARY KEY REFERENCES zapmass.users (id) ON DELETE CASCADE,
  doc JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_updated
  ON zapmass.user_subscriptions (updated_at DESC);

CREATE TABLE IF NOT EXISTS zapmass.tenant_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'info',
  category TEXT NOT NULL DEFAULT 'other',
  read BOOLEAN NOT NULL DEFAULT false,
  campaign_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_notifications_tenant_created
  ON zapmass.tenant_notifications (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS zapmass.app_config_global (
  id TEXT PRIMARY KEY DEFAULT 'global',
  doc JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO zapmass.app_config_global (id, doc)
VALUES ('global', '{}')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS zapmass.tenant_dispatch_settings (
  tenant_id UUID PRIMARY KEY REFERENCES zapmass.users (id) ON DELETE CASCADE,
  doc JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zapmass.tenant_app_profiles (
  tenant_id UUID PRIMARY KEY REFERENCES zapmass.users (id) ON DELETE CASCADE,
  use_segment TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zapmass.tenant_usage_stats (
  tenant_id UUID PRIMARY KEY REFERENCES zapmass.users (id) ON DELETE CASCADE,
  total_active_ms BIGINT NOT NULL DEFAULT 0,
  last_active_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zapmass.product_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  actor_subject_id TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  screen TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_suggestions_created
  ON zapmass.product_suggestions (created_at DESC);
