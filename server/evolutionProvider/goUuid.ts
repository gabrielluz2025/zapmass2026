/**
 * Evolution Go exige UUID RFC 4122 no header/path `instanceId`.
 * IDs ZapMass (`conn_<timestamp>_<n>`, ~20 chars) NÃO são UUID — enviá-los
 * gera `invalid UUID format: invalid UUID length: 20`.
 */

const UUID_DASHED_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_HEX32_RE = /^[0-9a-f]{32}$/i;

export function isEvolutionGoUuid(value: unknown): value is string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return false;
  return UUID_DASHED_RE.test(s) || UUID_HEX32_RE.test(s);
}

export function pickGoInstanceUuid(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && isEvolutionGoUuid(c)) return c.trim();
  }
  return undefined;
}

export function pickGoInstanceUuidFromRow(row: Record<string, unknown> | null | undefined): string | undefined {
  if (!row) return undefined;
  const inst = row.instance && typeof row.instance === 'object' ? (row.instance as Record<string, unknown>) : undefined;
  const nested = row.data && typeof row.data === 'object' ? (row.data as Record<string, unknown>) : undefined;
  return pickGoInstanceUuid(
    row.id,
    row.ID,
    row.instanceId,
    row.hash,
    inst?.instanceId,
    inst?.id,
    nested?.id,
    nested?.instanceId,
    nested?.ID
  );
}
