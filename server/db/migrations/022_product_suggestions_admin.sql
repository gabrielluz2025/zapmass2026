-- Triagem e respostas de sugestões de produto (VPS / Postgres)

ALTER TABLE zapmass.product_suggestions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'received',
  ADD COLUMN IF NOT EXISTS admin_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reply_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_replied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_replied_by TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS zapmass.product_suggestion_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id UUID NOT NULL REFERENCES zapmass.product_suggestions (id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  admin_email TEXT NOT NULL DEFAULT '',
  admin_uid TEXT NOT NULL DEFAULT '',
  email_sent BOOLEAN NOT NULL DEFAULT false,
  email_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_suggestion_replies_suggestion
  ON zapmass.product_suggestion_replies (suggestion_id, created_at ASC);
