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

export function isPhoneBlockedByFrequencyCap(
  normalizedPhoneDigits: string,
  blocked: ReadonlySet<string>
): boolean {
  const key = String(normalizedPhoneDigits || '').replace(/\D/g, '').slice(-11);
  return key.length >= 8 && blocked.has(key);
}
