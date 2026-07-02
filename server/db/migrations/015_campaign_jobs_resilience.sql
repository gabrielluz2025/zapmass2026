-- Resiliência de fila de campanhas: fonte da verdade em PostgreSQL.
-- Cada job de envio é registrado aqui. BullMQ continua como executor principal,
-- mas este registro permite auditoria, recovery e DLQ mesmo após crash do Redis.
--
-- Estados: pending → sending → sent
--                  → failed → (retry) → pending
--                           → dead (DLQ após max_attempts)

CREATE TABLE IF NOT EXISTS zapmass.campaign_jobs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  TEXT        NOT NULL,
  campaign_id      UUID        REFERENCES zapmass.campaigns(id) ON DELETE SET NULL,
  tenant_id        UUID        NOT NULL REFERENCES zapmass.users(id) ON DELETE CASCADE,
  connection_id    TEXT        NOT NULL,
  to_number        TEXT        NOT NULL,
  stage_index      INTEGER     NOT NULL DEFAULT 0,
  payload          JSONB       NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','sending','sent','failed','dead')),
  attempts         INTEGER     NOT NULL DEFAULT 0,
  max_attempts     INTEGER     NOT NULL DEFAULT 3,
  next_retry_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at        TIMESTAMPTZ,
  locked_by        TEXT,
  last_error       TEXT,
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_campaign_jobs_idempotency UNIQUE (idempotency_key)
);

-- Índices para worker e reaper
CREATE INDEX IF NOT EXISTS idx_cjobs_status_next_retry
  ON zapmass.campaign_jobs (status, next_retry_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_cjobs_campaign
  ON zapmass.campaign_jobs (campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_cjobs_tenant
  ON zapmass.campaign_jobs (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_cjobs_sending_locked
  ON zapmass.campaign_jobs (locked_at)
  WHERE status = 'sending';

-- Tabela para alertas e métricas de DLQ
CREATE TABLE IF NOT EXISTS zapmass.campaign_jobs_dlq_alerts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES zapmass.users(id) ON DELETE CASCADE,
  campaign_id UUID        REFERENCES zapmass.campaigns(id) ON DELETE SET NULL,
  dead_count  INTEGER     NOT NULL,
  alerted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
