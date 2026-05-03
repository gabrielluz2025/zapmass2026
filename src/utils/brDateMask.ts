/**
 * Máscara de data brasileira: só dígitos, barras automáticas, máx. DD/MM/AAAA (8 dígitos).
 * Aceita também DD/MM/AA (6 dígitos) — o último segmento pode ter 2 ou 4 algarismos.
 */

const MAX_DIGITS = 8;

/** Extrai até 8 dígitos e formata com `/` após dia e mês. */
export function maskBrDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, MAX_DIGITS);
  if (!digits) return '';
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** Normaliza valor já guardado (ex.: ISO `AAAA-MM-DD`) para exibição com máscara. */
export function storedDateToBrDisplay(stored: string): string {
  const t = (stored || '').trim();
  if (!t) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) {
    const yyyy = iso[1];
    const mm = iso[2];
    const dd = iso[3];
    return `${dd}/${mm}/${yyyy}`;
  }
  return maskBrDateInput(t);
}
