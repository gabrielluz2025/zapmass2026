-- Biblioteca de campanhas: modelos de mensagem e segmentos de público salvos.
-- Cada linha é um item por tenant, com payload em JSONB para flexibilidade.

CREATE TABLE IF NOT EXISTS zapmass.campaign_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  doc JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_templates_tenant
  ON zapmass.campaign_templates (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS zapmass.campaign_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  doc JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_segments_tenant
  ON zapmass.campaign_segments (tenant_id, updated_at DESC);
