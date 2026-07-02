-- Pool de conexões: agrupa chips WhatsApp para uso compartilhado em campanhas.
-- Campanhas podem referenciar um pool em vez de chips individuais;
-- na hora do disparo o sistema resolve o pool para os chips ativos.
CREATE TABLE IF NOT EXISTS zapmass.connection_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  -- connection_ids: array de IDs de chips pertencentes ao pool
  -- channel_weights: { "conn_id": weight } para balanceamento personalizado
  -- strategy: 'round_robin' | 'weighted' | 'priority'
  doc JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connection_pools_tenant ON zapmass.connection_pools (tenant_id, created_at DESC);
