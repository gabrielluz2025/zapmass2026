CREATE TABLE IF NOT EXISTS zapmass.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES zapmass.users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user ON zapmass.password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_expires
  ON zapmass.password_reset_tokens (expires_at)
  WHERE used_at IS NULL;
