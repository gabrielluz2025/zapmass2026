ALTER TABLE zapmass.users ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE zapmass.workspace_members ADD COLUMN IF NOT EXISTS photo_url TEXT;
