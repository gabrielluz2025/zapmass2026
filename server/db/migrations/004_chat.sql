CREATE TABLE IF NOT EXISTS zapmass.wa_chat_threads (
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  last_connection_id TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  schema_version INT NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_chat_threads_tenant_updated
  ON zapmass.wa_chat_threads (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS zapmass.wa_chat_messages (
  tenant_id UUID NOT NULL,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  sender TEXT NOT NULL DEFAULT 'them',
  status TEXT NOT NULL DEFAULT 'sent',
  type TEXT NOT NULL DEFAULT 'text',
  timestamp_ms BIGINT NOT NULL DEFAULT 0,
  media_url TEXT,
  from_campaign BOOLEAN NOT NULL DEFAULT false,
  campaign_id TEXT,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, thread_id, message_id),
  FOREIGN KEY (tenant_id, thread_id)
    REFERENCES zapmass.wa_chat_threads (tenant_id, thread_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wa_chat_messages_thread_ts
  ON zapmass.wa_chat_messages (tenant_id, thread_id, timestamp_ms DESC);

CREATE TABLE IF NOT EXISTS zapmass.inbox_assignments (
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  claimed_by_subject_id TEXT NOT NULL,
  connection_id TEXT NOT NULL DEFAULT '',
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  transferred_from_subject_id TEXT,
  transferred_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_inbox_assignments_tenant
  ON zapmass.inbox_assignments (tenant_id);

CREATE TABLE IF NOT EXISTS zapmass.inbox_attendance_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  actor_subject_id TEXT NOT NULL,
  assigned_to_subject_id TEXT,
  rating INT,
  comment TEXT,
  skipped_survey BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbox_feedback_tenant_created
  ON zapmass.inbox_attendance_feedback (tenant_id, created_at DESC);
