/**
 * Parser leve de arquivos vCard (.vcf) exportados de Android/iPhone.
 * Cobre FN, N, TEL (vários), EMAIL, ADR, BDAY, NOTE, ORG, TITLE — sem dependências pesadas.
 */

export interface ParsedVcfEntry {
  name: string;
  /** Primeiro telefone escolhido (apenas dígitos, já com DDI quando possível). */
  phoneDigits: string;
  email: string;
  birthday: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  neighborhood: string;
  notes: string;
  profession: string;
  church: string;
}

const BR_PHONE_FROM_DIGITS = (d: string): string => {
  if (!d) return '';
  if (d.length >= 12 && d.length <= 13 && d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
};

function unescapeVcfValue(v: string): string {
  return String(v || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\N/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** Desdobra linhas vCard (continuações com espaço/tab). */
function unfoldToLines(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rough = normalized.split('\n');
  const out: string[] = [];
  for (const line of rough) {
    if (/^[ \t]/.test(line) && out.length > 0) {
      out[out.length - 1] += line.substring(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Extrai blocos ENTRE BEGIN:VCARD e END:VCARD (case-insensitive). */
function sliceVcards(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let cur: string[] | null = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^BEGIN:VCARD/i.test(t)) {
      cur = [];
      continue;
    }
    if (/^END:VCARD/i.test(t)) {
      if (cur && cur.length) blocks.push(cur);
      cur = null;
      continue;
    }
    if (cur) cur.push(line);
  }
  return blocks;
}

function propNameFromLeft(left: string): string {
  const base = left.split(';')[0].trim();
  const dot = base.lastIndexOf('.');
  // iOS/Android: ITEM1.TEL, ITEM2.EMAIL
  const key = dot >= 0 ? base.slice(dot + 1) : base;
  return key.toUpperCase();
}

function leftHasType(left: string, ...aliases: string[]): boolean {
  const u = left.toUpperCase();
  return aliases.some((a) => u.includes(`TYPE=${a}`) || u.includes(`TYPE=${a.toUpperCase()}`));
}

function parseAdrValue(val: string): {
  street: string;
  city: string;
  state: string;
  zip: string;
  neighborhood: string;
} {
  const p = unescapeVcfValue(val).split(';');
  return {
    street: (p[2] || '').trim(),
    neighborhood: (p[1] || '').trim(),
    city: (p[3] || '').trim(),
    state: (p[4] || '').trim().slice(0, 2).toUpperCase(),
    zip: (p[5] || '').replace(/\D/g, '').slice(0, 8)
  };
}

function nameFromN(raw: string): string {
  const p = unescapeVcfValue(raw).split(';').map((s) => s.trim());
  const family = p[0] || '';
  const given = p[1] || '';
  const mid = p[2] || '';
  const prefix = p[3] || '';
  const suffix = p[4] || '';
  const parts = [prefix, given, mid, family, suffix].filter(Boolean);
  if (parts.length) return parts.join(' ').replace(/\s+/g, ' ').trim();
  return '';
}

function normalizeBirthday(raw: string): string {
  const v = unescapeVcfValue(raw).trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{8}$/.test(v)) {
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const br = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/;
  if (br.test(v)) {
    const mm = v.match(br)!;
    const yyyy = mm[3].length === 2 ? `19${mm[3]}` : mm[3];
    return `${yyyy}-${mm[2].padStart(2, '0')}-${mm[1].padStart(2, '0')}`;
  }
  return v;
}

function telToDigits(value: string): string {
  let s = unescapeVcfValue(value).replace(/^tel:/i, '').trim();
  s = s.split(';')[0].trim();
  const d = s.replace(/\D/g, '');
  return BR_PHONE_FROM_DIGITS(d);
}

function pickBestPhone(tels: { digits: string; left: string }[]): string {
  if (!tels.length) return '';
  const pref = (t: { left: string }) =>
    leftHasType(t.left, 'CELL', 'MOBILE', 'IPHONE', 'VOICE', 'PREF') ? 2 : 1;
  const sorted = [...tels].sort((a, b) => pref(b) - pref(a));
  for (const t of sorted) {
    if (t.digits.replace(/\D/g, '').length >= 10) return t.digits.replace(/\D/g, '');
  }
  return (sorted[0].digits || '').replace(/\D/g, '');
}

function parseCardLines(lines: string[]): ParsedVcfEntry {
  let fn = '';
  let nRaw = '';
  const tels: { digits: string; left: string }[] = [];
  const emails: string[] = [];
  let adr: ReturnType<typeof parseAdrValue> | null = null;
  let bday = '';
  const notes: string[] = [];
  let org = '';
  let title = '';

  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const left = line.slice(0, idx);
    const rawVal = line.slice(idx + 1);
    const prop = propNameFromLeft(left);
    if (prop === 'VERSION' || prop === 'UID' || prop === 'PRODID' || prop === 'REV' || prop === 'PHOTO') {
      continue;
    }
    if (prop === 'FN') {
      fn = unescapeVcfValue(rawVal).trim();
    } else if (prop === 'N') {
      nRaw = rawVal;
    } else if (prop === 'TEL') {
      const d = telToDigits(rawVal);
      if (d) tels.push({ digits: d, left });
    } else if (prop === 'EMAIL') {
      const e = unescapeVcfValue(rawVal).trim();
      if (e) emails.push(e);
    } else if (prop === 'ADR') {
      adr = parseAdrValue(rawVal);
    } else if (prop === 'BDAY' || prop === 'X-BDAY') {
      bday = normalizeBirthday(rawVal);
    } else if (prop === 'NOTE' || prop === 'NOTES') {
      const n = unescapeVcfValue(rawVal).trim();
      if (n) notes.push(n);
    } else if (prop === 'ORG') {
      org = unescapeVcfValue(rawVal).replace(/\\;/g, ';').split(';')[0].trim();
    } else if (prop === 'TITLE') {
      title = unescapeVcfValue(rawVal).trim();
    }
  }

  let name = fn || nameFromN(nRaw) || '';
  if (!name && emails[0]) name = emails[0].split('@')[0] || '';
  if (!name) name = '';

  const phoneDigits = pickBestPhone(tels);
  const email = emails[0] || '';
  const noteText = notes.join('\n\n');
  const extraNote = org && !noteText.includes(org) ? (noteText ? `${noteText}\n\n` : '') + `Organização: ${org}` : noteText;

  return {
    name,
    phoneDigits,
    email,
    birthday: bday,
    street: adr?.street || '',
    city: adr?.city || '',
    state: adr?.state || '',
    zipCode: adr?.zip || '',
    neighborhood: adr?.neighborhood || '',
    notes: extraNote,
    profession: title,
    church: ''
  };
}

/**
 * Lê o texto completo de um ficheiro .vcf e devolve uma entrada por contacto.
 */
export function parseVcfText(text: string): ParsedVcfEntry[] {
  const lines = unfoldToLines(text);
  const cards = sliceVcards(lines);
  const out: ParsedVcfEntry[] = [];
  for (const block of cards) {
    try {
      out.push(parseCardLines(block));
    } catch {
      /* ignora bloco inválido */
    }
  }
  return out;
}
