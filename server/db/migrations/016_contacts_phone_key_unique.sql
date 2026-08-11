-- Impede contatos duplicados por telefone no mesmo tenant.
-- phone_key = dígitos canônicos (DDI 55 + celular BR unificado).

ALTER TABLE zapmass.contacts
  ADD COLUMN IF NOT EXISTS phone_key TEXT NOT NULL DEFAULT '';

-- Backfill aproximando normPhoneKey / normalizeBRPhone (só dígitos + 55 + 9 do celular).
UPDATE zapmass.contacts
SET phone_key = (
  WITH d0 AS (
    SELECT regexp_replace(COALESCE(phone, ''), '\D', '', 'g') AS digits
  ),
  d1 AS (
    SELECT CASE
      WHEN digits ~ '^0\d{10,11}$' THEN substring(digits from 2)
      ELSE digits
    END AS digits
    FROM d0
  ),
  d2 AS (
    SELECT CASE
      WHEN length(digits) IN (10, 11) AND digits NOT LIKE '55%' THEN '55' || digits
      WHEN length(digits) = 12 AND digits LIKE '547%' THEN '5547' || substring(digits from 4)
      WHEN length(digits) = 11 AND digits LIKE '547%' THEN '479' || substring(digits from 4)
      ELSE digits
    END AS digits
    FROM d1
  ),
  d3 AS (
    SELECT CASE
      WHEN digits LIKE '55%' AND length(digits) = 12 THEN
        substring(digits from 1 for 4) || '9' || substring(digits from 5)
      ELSE digits
    END AS digits
    FROM d2
  )
  SELECT digits FROM d3
)
WHERE phone_key = '' OR phone_key IS NULL;

-- Telefone vazio: chave única artificial por id (não colide no UNIQUE).
UPDATE zapmass.contacts
SET phone_key = '__empty__:' || id::text
WHERE phone_key = '';

-- Mapa duplicados → contato a manter (mais antigo).
DROP TABLE IF EXISTS _zm_phone_dedupe;
CREATE TEMP TABLE _zm_phone_dedupe ON COMMIT DROP AS
SELECT
  d.id AS old_id,
  k.id AS new_id,
  d.tenant_id
FROM (
  SELECT
    id,
    tenant_id,
    phone_key,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, phone_key
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM zapmass.contacts
  WHERE phone_key NOT LIKE '__empty__:%'
) d
JOIN (
  SELECT
    id,
    tenant_id,
    phone_key,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, phone_key
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM zapmass.contacts
  WHERE phone_key NOT LIKE '__empty__:%'
) k
  ON k.tenant_id = d.tenant_id
 AND k.phone_key = d.phone_key
 AND k.rn = 1
WHERE d.rn > 1;

-- Reescreve contact_ids das listas: ids duplicados viram o id mantido.
UPDATE zapmass.contact_lists cl
SET contact_ids = sub.new_ids,
    updated_at = now()
FROM (
  SELECT
    cl2.id AS list_id,
    COALESCE(
      (
        SELECT jsonb_agg(DISTINCT mapped ORDER BY mapped)
        FROM (
          SELECT COALESCE(m.new_id::text, elem) AS mapped
          FROM jsonb_array_elements_text(COALESCE(cl2.contact_ids, '[]'::jsonb)) AS elem
          LEFT JOIN _zm_phone_dedupe m ON m.old_id::text = elem
        ) x
      ),
      '[]'::jsonb
    ) AS new_ids
  FROM zapmass.contact_lists cl2
) sub
WHERE cl.id = sub.list_id
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(cl.contact_ids, '[]'::jsonb)) AS elem
    JOIN _zm_phone_dedupe m ON m.old_id::text = elem
  );

DELETE FROM zapmass.contacts c
USING _zm_phone_dedupe m
WHERE c.id = m.old_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_tenant_phone_key_unique
  ON zapmass.contacts (tenant_id, phone_key);
