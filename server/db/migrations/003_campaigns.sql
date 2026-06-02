CREATE TABLE IF NOT EXISTS zapmass.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  next_run_at TIMESTAMPTZ,
  schedule_lock_until TIMESTAMPTZ,
  doc JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_created ON zapmass.campaigns (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled_due ON zapmass.campaigns (status, next_run_at)
  WHERE status = 'SCHEDULED';

CREATE TABLE IF NOT EXISTS zapmass.campaign_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES zapmass.campaigns (id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'INFO',
  message TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_logs_campaign ON zapmass.campaign_logs (campaign_id, created_at DESC);
