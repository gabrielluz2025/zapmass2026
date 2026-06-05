/** Apenas dígitos. */
export function phoneDigitsOnly(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

/**
 * Celular BR com DDI 55: unifica 12 dígitos (sem o 9 após DDD) e 13 (com o 9).
 * Ex.: 554799127001 ↔ 5547999127001
 */
export function canonicalBrazilMobileKey(digits: string): string {
  const d = phoneDigitsOnly(digits);
  if (!d.startsWith('55') || d.length < 12) return d;
  if (d.length === 13) {
    const afterDdd = d.slice(4);
    if (afterDdd.length === 9 && afterDdd[0] === '9') return d;
    return d;
  }
  if (d.length === 12) {
    const ddd = d.slice(2, 4);
    const local = d.slice(4);
    if (local.length === 8) return `55${ddd}9${local}`;
  }
  return d;
}

/**
 * Discagem nacional BR com 0 antes do DDD (comum em planilhas): 11 ou 12 dígitos no total.
 * Ex.: 048996460175 → 48996460175 | 011999999999 → 11999999999
 */
export function stripBrazilNationalTrunkZero(digits: string): string {
  if (!digits || digits.startsWith('55')) return digits;
  const m = digits.match(/^0(\d{10}|\d{11})$/);
  return m ? m[1] : digits;
}

/** Chave única por telefone (BR: 0 tronco + DDI 55 quando faltar). */
export function normPhoneKey(p: string): string {
  let d = stripBrazilNationalTrunkZero(phoneDigitsOnly(p));
  if (!d) return '';
  if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) d = `55${d}`;
  return canonicalBrazilMobileKey(d);
}

/** Normaliza telefone BR para armazenamento (DDI 55, remove 0 tronco nacional). */
export function normalizeBRPhone(raw: string): string {
  let d = stripBrazilNationalTrunkZero(phoneDigitsOnly(raw));
  if (!d) return '';
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return canonicalBrazilMobileKey(d);
  return d;
}
