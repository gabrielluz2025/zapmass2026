/** Apenas dígitos. */
export function phoneDigitsOnly(raw: string): string {
  return (raw || '').replace(/\D/g, '');
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
  return d;
}

/** Normaliza telefone BR para armazenamento (DDI 55, remove 0 tronco nacional). */
export function normalizeBRPhone(raw: string): string {
  let d = stripBrazilNationalTrunkZero(phoneDigitsOnly(raw));
  if (!d) return '';
  if (d.length >= 12 && d.length <= 13 && d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}
