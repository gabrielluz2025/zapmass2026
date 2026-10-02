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

export function buildFrequencyCapResendPhoneKeys(phones?: string[]): Set<string> {
  const set = new Set<string>();
  for (const p of phones || []) {
    const key = String(p || '').replace(/\D/g, '').slice(-11);
    if (key.length >= 8) set.add(key);
  }
  return set;
}

export function isPhoneInFrequencyCapResendAllowlist(
  normalizedPhoneDigits: string,
  resendKeys: ReadonlySet<string>
): boolean {
  const key = String(normalizedPhoneDigits || '').replace(/\D/g, '').slice(-11);
  return key.length >= 8 && resendKeys.has(key);
}

/** Pula o cap 24 h globalmente ou para contatos liberados no preview. */
export function shouldBypassFrequencyCap(
  normalizedPhoneDigits: string,
  options: {
    skipFrequencyCap?: boolean;
    allowKeys?: ReadonlySet<string> | null;
  }
): boolean {
  if (options.skipFrequencyCap === true) return true;
  const allowKeys = options.allowKeys;
  if (!allowKeys?.size) return false;
  const key = phoneKeyForFrequencyCap(normalizedPhoneDigits);
  return key.length >= 8 && allowKeys.has(key);
}
