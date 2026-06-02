import { looksLikeLongLidDigits } from '../src/utils/contactPhoneLookup.js';

/** Nome legível de um registro findContacts / findChats (agenda do celular → `notify`). */
export function filterEvolutionContactLabel(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  const lower = t.toLowerCase();
  if (lower === 'contato' || lower === 'contact' || lower === 'unknown' || lower === 'desconhecido') {
    return undefined;
  }
  if (looksLikeLongLidDigits(t)) return undefined;
  return t;
}

/** Prioridade: nome salvo no telefone (`notify`) → `name` → pushName → verifiedName. */
export function evolutionContactDisplayName(row: Record<string, unknown> | null | undefined): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const nested =
    row.contact && typeof row.contact === 'object'
      ? (row.contact as Record<string, unknown>)
      : null;
  const candidates = [
    row.notify,
    row.contactName,
    row.name,
    nested?.name,
    nested?.notify,
    row.pushName,
    row.verifiedName,
    row.shortName,
    row.formattedName
  ];
  for (const c of candidates) {
    const hit = filterEvolutionContactLabel(c);
    if (hit) return hit;
  }
  return undefined;
}
