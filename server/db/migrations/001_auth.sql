CREATE SCHEMA IF NOT EXISTS zapmass;

CREATE TABLE IF NOT EXISTS zapmass.schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zapmass.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email_norm ON zapmass.users (email_normalized);

CREATE TABLE IF NOT EXISTS zapmass.workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  login_slug TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (owner_user_id, login_slug)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_owner ON zapmass.workspace_members (owner_user_id);

CREATE TABLE IF NOT EXISTS zapmass.refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  owner_user_id UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_subject ON zapmass.refresh_tokens (subject_id);
