/** Converte número serial do Excel (datas) em ISO UTC quando plausível. */
function excelSerialDateToIso(serial: number): string | undefined {
  if (!Number.isFinite(serial) || serial < 18000 || serial > 120000) return undefined;
  const utcMs = (serial - 25569) * 86400 * 1000;
  const d = new Date(utcMs);
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}

/** Importação XLSX/planilha (texto livre ou número serial). Devolve ISO UTC ou `undefined`. */
export function parseImportFollowUpAt(raw: unknown): string | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return undefined;
    if (Math.abs(raw) >= 18000 && Math.abs(raw) <= 120000 && !Number.isInteger(raw)) {
      const intPart = Math.floor(raw);
      const frac = raw - intPart;
      const isoDay = excelSerialDateToIso(intPart);
      if (!isoDay) return undefined;
      const secs = Math.round(frac * 86400);
      const d = new Date(+new Date(isoDay) + secs * 1000);
      return Number.isFinite(d.getTime()) ? d.toISOString() : isoDay;
    }
    if (raw > 1e11) {
      const d = new Date(raw);
      return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
    }
    return excelSerialDateToIso(raw);
  }
  const v = String(raw).trim();
  if (!v) return undefined;
  const iso = parseFirestoreDateToIso(v);
  if (iso) return iso;
  const br = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
  const m = v.match(br);
  if (m) {
    let year = parseInt(m[3], 10);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const month = parseInt(m[2], 10) - 1;
    const day = parseInt(m[1], 10);
    const hh = m[4] != null ? parseInt(m[4], 10) : 12;
    const mm = m[5] != null ? parseInt(m[5], 10) : 0;
    const ss = m[6] != null ? parseInt(m[6], 10) : 0;
    const d = new Date(year, month, day, hh, mm, ss);
    return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
  }
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}

/** Converte valores Firestore/string/número em ISO UTC para `followUpAt`. */
export function parseFirestoreDateToIso(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
  }
  if (typeof v === 'object' && v !== null && typeof (v as { toDate?: () => Date }).toDate === 'function') {
    const d = (v as { toDate: () => Date }).toDate();
    return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
  }
  return undefined;
}

export function parseFollowUpMs(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function localStartOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function localStartOfTomorrowMs(): number {
  const d = new Date(localStartOfTodayMs());
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Janela: de hoje (00:00) até antes do 8º dia (7 dias inclusos até fim do 7º dia). */
export function localEndRetornoWeekWindowMs(): number {
  const d = new Date(localStartOfTodayMs());
  d.setDate(d.getDate() + 7);
  return d.getTime();
}

export function isoToDatetimeLocal(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function datetimeLocalToUtcIso(localValue: string): string | undefined {
  const v = (localValue || '').trim();
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(+d)) return undefined;
  return d.toISOString();
}

export function formatFollowUpLabel(iso?: string): string {
  const ms = parseFollowUpMs(iso);
  if (ms == null) return '';
  const d = new Date(ms);
  return d.toLocaleString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function matchesRetornoFilter(
  followUpMs: number | null,
  filter:
    | 'retorno_todos'
    | 'retorno_atrasados'
    | 'retorno_hoje'
    | 'retorno_semana'
): boolean {
  if (followUpMs == null) return false;
  const startToday = localStartOfTodayMs();
  const startTomorrow = localStartOfTomorrowMs();
  const endWeek = localEndRetornoWeekWindowMs();

  switch (filter) {
    case 'retorno_todos':
      return true;
    case 'retorno_atrasados':
      return followUpMs < startToday;
    case 'retorno_hoje':
      return followUpMs >= startToday && followUpMs < startTomorrow;
    case 'retorno_semana':
      return followUpMs >= startToday && followUpMs < endWeek;
    default:
      return false;
  }
}
