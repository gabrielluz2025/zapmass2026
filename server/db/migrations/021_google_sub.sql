ALTER TABLE zapmass.users
  ADD COLUMN IF NOT EXISTS google_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub
  ON zapmass.users (google_sub)
  WHERE google_sub IS NOT NULL;
