/** UF sintética para internacional / número sem DDD BR reconhecível */
export const GEO_UNKNOWN_UF = 'OUT';

/** Infere UF a partir do DDD (Brasil). Apenas agregação analítica; não é GPS. */

const DDD_TO_UF: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  const add = (ddds: number[], uf: string) => {
    for (const d of ddds) {
      const k = String(d).padStart(2, '0');
      m[k] = uf;
    }
  };
  add([11, 12, 13, 14, 15, 16, 17, 18, 19], 'SP');
  add([21, 22, 23, 24], 'RJ');
  add([27, 28], 'ES');
  add([31, 32, 33, 34, 35, 37, 38], 'MG');
  add([41, 42, 43, 44, 45, 46], 'PR');
  add([47, 48, 49], 'SC');
  add([51, 53, 54, 55], 'RS');
  add([61], 'DF');
  add([62, 64], 'GO');
  add([63], 'TO');
  add([65, 66], 'MT');
  add([67], 'MS');
  add([68], 'AC');
  add([69], 'RO');
  add([71, 73, 74, 75, 77], 'BA');
  add([79], 'SE');
  add([81, 87], 'PE');
  add([82], 'AL');
  add([83], 'PB');
  add([84], 'RN');
  add([85, 88], 'CE');
  add([86, 89], 'PI');
  add([91, 93, 94], 'PA');
  add([92, 97], 'AM');
  add([95], 'RR');
  add([96], 'AP');
  add([98, 99], 'MA');
  return m;
})();

export function normalizeBrazilPhoneDigits(input: string): string {
  let d = String(input || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length > 2) d = d.slice(2);
  if (d.length > 11) d = d.slice(0, 11);
  return d;
}

export function phoneDigitsToUf(digits: string): string | null {
  const d = normalizeBrazilPhoneDigits(digits);
  if (d.length < 10) return null;
  const ddd = d.slice(0, 2);
  return DDD_TO_UF[ddd] || null;
}
