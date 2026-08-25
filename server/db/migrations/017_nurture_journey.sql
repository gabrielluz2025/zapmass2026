-- Jornada de nutrição: sequência programada para leads quentes (fora da cota de campanha)

CREATE TABLE IF NOT EXISTS zapmass.nurture_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Jornada principal',
  enabled BOOLEAN NOT NULL DEFAULT false,
  doc JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nurture_journeys_tenant
  ON zapmass.nurture_journeys (tenant_id);

CREATE TABLE IF NOT EXISTS zapmass.nurture_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  journey_id UUID NOT NULL REFERENCES zapmass.nurture_journeys (id) ON DELETE CASCADE,
  contact_phone TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'enrolled',
  current_step_index INT NOT NULL DEFAULT 0,
  step_entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_run_at TIMESTAMPTZ,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  pause_reason TEXT,
  last_sent_day_key TEXT,
  vars JSONB NOT NULL DEFAULT '{}',
  UNIQUE (journey_id, contact_phone)
);

CREATE INDEX IF NOT EXISTS idx_nurture_enroll_due
  ON zapmass.nurture_enrollments (tenant_id, status, next_run_at)
  WHERE status IN ('enrolled', 'active', 'waiting_reply');

CREATE INDEX IF NOT EXISTS idx_nurture_enroll_phone
  ON zapmass.nurture_enrollments (tenant_id, contact_phone);

CREATE TABLE IF NOT EXISTS zapmass.nurture_metrics (
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  journey_id UUID NOT NULL REFERENCES zapmass.nurture_journeys (id) ON DELETE CASCADE,
  materials_sent INT NOT NULL DEFAULT 0,
  replies_received INT NOT NULL DEFAULT 0,
  handoffs INT NOT NULL DEFAULT 0,
  opt_outs INT NOT NULL DEFAULT 0,
  completed INT NOT NULL DEFAULT 0,
  active_enrollments INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, journey_id)
);
