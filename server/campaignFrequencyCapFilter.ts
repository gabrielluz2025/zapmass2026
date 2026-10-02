/** Helpers para não enfileirar contatos já no limite 24 h (evita RUNNING 100% / 0 entregues). */

export function buildFrequencyCapBlockSet(
  results: Array<{ capped?: boolean; phoneKey?: string }>
): Set<string> {
  const blocked = new Set<string>();
  for (const r of results) {
    if (r.capped && r.phoneKey) blocked.add(r.phoneKey);
  }
  return blocked;
}

export function phoneKeyForFrequencyCap(phone: string): string {
  return String(phone || '').replace(/\D/g, '').slice(-11);
}

export function normalizeFrequencyCapAllowKeys(phones: string[] | undefined): Set<string> {
  const out = new Set<string>();
  if (!phones?.length) return out;
  for (const p of phones) {
    const key = phoneKeyForFrequencyCap(p);
    if (key.length >= 8) out.add(key);
  }
  return out;
}

/** Remove do bloqueio os contatos autorizados a reenvio (seleção granular na UI). */
export function applyFrequencyCapAllowList(
  blocked: ReadonlySet<string>,
  allowKeys: ReadonlySet<string>
): Set<string> {
  if (!allowKeys.size) return new Set(blocked);
  const next = new Set(blocked);
  for (const key of allowKeys) next.delete(key);
  return next;
}

export function isPhoneBlockedByFrequencyCap(
  normalizedPhoneDigits: string,
  blocked: ReadonlySet<string>
): boolean {
  const key = phoneKeyForFrequencyCap(normalizedPhoneDigits);
  return key.length >= 8 && blocked.has(key);
}
