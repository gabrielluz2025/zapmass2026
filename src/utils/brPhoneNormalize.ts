/** Apenas dígitos. */
export function phoneDigitsOnly(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

/** Remove DDI 55 duplicado (ex.: 555547999912345 → 5547999912345). */
export function stripDuplicateBrazilDdi(digits: string): string {
  let d = phoneDigitsOnly(digits);
  while (d.startsWith('5555') && d.length > 13) d = d.slice(2);
  return d;
}

/** Prefixo ANATEL do assinante (8 dígitos): 2–5 fixo, 6–9 celular. */
const BR_LANDLINE_SUB_PREFIX = /^[2-5]/;
const BR_MOBILE_SUB_PREFIX = /^[6-9]/;

/**
 * Celular BR com DDI 55: unifica 12 dígitos (sem o 9 após DDD) e 13 (com o 9).
 * Não inventa 9º dígito em telefone fixo (2–5) — isso gerava exists:false no WhatsApp.
 * Ex. celular: 554799127001 ↔ 5547999127001
 * Ex. fixo: 554732375383 permanece 12 dígitos; 5547932375383 (9 indevido) volta ao fixo.
 */
export function canonicalBrazilMobileKey(digits: string): string {
  const d = phoneDigitsOnly(digits);
  if (!d.startsWith('55') || d.length < 12) return d;
  const ddd = d.slice(2, 4);
  if (d.length === 13) {
    const afterDdd = d.slice(4);
    if (afterDdd.length === 9 && afterDdd[0] === '9') {
      const rest = afterDdd.slice(1);
      if (BR_LANDLINE_SUB_PREFIX.test(rest)) return `55${ddd}${rest}`;
      return d;
    }
    return d;
  }
  if (d.length === 12) {
    const local = d.slice(4);
    if (local.length === 8 && BR_MOBILE_SUB_PREFIX.test(local)) return `55${ddd}9${local}`;
    return d;
  }
  return d;
}

/**
 * Discagem nacional BR com 0 antes do DDD (comum em planilhas).
 * Ex.: 048996460175 → 48996460175 | 011999999999 → 11999999999
 * Ex.: 0479996392111 (13 dígitos) → 479996392111 → reparo posterior
 */
export function stripBrazilNationalTrunkZero(digits: string): string {
  if (!digits || digits.startsWith('55')) return digits;
  const d = phoneDigitsOnly(digits);
  if (d.startsWith('0')) {
    const stripped = d.replace(/^0+/, '');
    if (stripped.length >= 10 && stripped.length <= 12) return stripped;
  }
  const m = d.match(/^0(\d{10}|\d{11})$/);
  return m ? m[1] : d;
}

/**
 * Repara nacional BR com dígitos a mais após o DDD (planilhas/exportações).
 * Ex.: 479996392111 (12) → 47996392111 (11) quando local começa com 99…
 */
export function repairBrazilNationalOversizedLocal(digits: string): string {
  const d = phoneDigitsOnly(digits);
  if (!d || d.startsWith('55')) return d;
  if (d.length !== 11 && d.length !== 12) return d;
  const ddd = d.slice(0, 2);
  if (!/^[1-9]\d$/.test(ddd)) return d;
  const local = d.slice(2);
  if (local.length === 10 && local.startsWith('99')) {
    return `${ddd}9${local.slice(2)}`;
  }
  if (local.length === 10 && local[0] === '9') {
    return `${ddd}${local.slice(0, 9)}`;
  }
  return d;
}

/**
 * Repara JIDs corrompidos retornados pela Evolution (ex.: slice(-12) vira 547… em vez de 5547…).
 * 54784556296 → 47984556296 | 547933371589 → 5547933371589
 */
export function repairCorruptedBrJidDigits(digits: string): string {
  const d = phoneDigitsOnly(digits);
  if (!d) return d;
  if (d.length === 12 && d.startsWith('547')) return `5547${d.slice(3)}`;
  if (d.length === 11 && d.startsWith('547')) return `479${d.slice(3)}`;
  return d;
}

/** E.164 BR plausível para WhatsApp (12 fixo ou 13 celular). */
export function isPlausibleBrazilWhatsAppPhone(digits: string): boolean {
  const d = phoneDigitsOnly(digits);
  if (!d.startsWith('55') || (d.length !== 12 && d.length !== 13)) return false;
  const ddd = d.slice(2, 4);
  if (!/^[1-9]\d$/.test(ddd)) return false;
  if (d.length === 13) return d[4] === '9';
  return /^[2-5]/.test(d.slice(4));
}

/** Chave única por telefone (BR: 0 tronco + DDI 55 quando faltar). */
export function normPhoneKey(p: string): string {
  let d = stripDuplicateBrazilDdi(
    repairCorruptedBrJidDigits(
      repairBrazilNationalOversizedLocal(stripBrazilNationalTrunkZero(phoneDigitsOnly(p)))
    )
  );
  if (!d) return '';
  if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) d = `55${d}`;
  return canonicalBrazilMobileKey(d);
}

/** Normaliza telefone BR para armazenamento (DDI 55, remove 0 tronco nacional). */
export function normalizeBRPhone(raw: string): string {
  let d = stripDuplicateBrazilDdi(
    repairCorruptedBrJidDigits(
      repairBrazilNationalOversizedLocal(stripBrazilNationalTrunkZero(phoneDigitsOnly(raw)))
    )
  );
  if (!d) return '';
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return canonicalBrazilMobileKey(d);
  if (!d.startsWith('55') && d.length === 12 && /^[1-9]\d/.test(d)) {
    d = `55${d}`;
    if (d.length === 14) {
      d = repairBrazilNationalOversizedLocal(d.slice(2));
      if (d.length === 11) d = `55${d}`;
    }
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return canonicalBrazilMobileKey(d);
  }
  return d;
}
