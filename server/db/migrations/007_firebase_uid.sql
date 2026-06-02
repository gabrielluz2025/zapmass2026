ALTER TABLE zapmass.users
  ADD COLUMN IF NOT EXISTS firebase_uid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid
  ON zapmass.users (firebase_uid)
  WHERE firebase_uid IS NOT NULL;

ALTER TABLE zapmass.workspace_members
  ADD COLUMN IF NOT EXISTS firebase_auth_uid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_members_firebase_auth
  ON zapmass.workspace_members (firebase_auth_uid)
  WHERE firebase_auth_uid IS NOT NULL;
