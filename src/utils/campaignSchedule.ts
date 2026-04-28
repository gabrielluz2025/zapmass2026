import type { CampaignScheduleSlot } from '../types';

const WEEKDAY_FROM_FORMAT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

/** Data local (yyyy-mm-dd) no fuso, para campo type="date" e agendamento único. */
export function formatTodayYmdInZone(timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = fmt.formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  if (year.length < 4 || !month || !day) return new Date().toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
}

function formatZonedYmdHmKey(utcMs: number, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const pick = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  const y = pick('year');
  const mo = pick('month').padStart(2, '0');
  const d = pick('day').padStart(2, '0');
  const hh = pick('hour').padStart(2, '0');
  const mn = pick('minute').padStart(2, '0');
  return `${y}-${mo}-${d}|${hh}:${mn}`;
}

/**
 * Converte data + hora de parede no fuso IANA para ISO UTC.
 * Usado no agendamento único (uma data de calendário escolhida pelo usuário).
 */
export function localDateTimeToUtcIso(dateStr: string, timeStr: string, timeZone: string): string | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
  if (!dm || !tm) return null;
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  const h = Number(tm[1]);
  const mi = Number(tm[2]);
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (h > 23 || mi > 59 || h < 0 || mi < 0) return null;
  const targetKey = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}|${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;

  const anchor = Date.UTC(y, mo - 1, d);
  const start = anchor - 28 * 60 * 60 * 1000;
  const end = anchor + 28 * 60 * 60 * 1000;

  for (let t = Math.floor(start / 60000) * 60000; t < end; t += 60000) {
    if (formatZonedYmdHmKey(t, timeZone) === targetKey) {
      return new Date(t).toISOString();
    }
  }
  return null;
}

/** Domingo = 0 … sábado = 6, coerente com Date#getDay — para uma data de calendário no fuso. */
export function dayOfWeekForCalendarDateInZone(dateStr: string, timeZone: string): number {
  const iso = localDateTimeToUtcIso(dateStr, '12:00', timeZone);
  if (!iso) return new Date(`${dateStr}T12:00:00`).getDay();
  return zonedWallClock(new Date(iso).getTime(), timeZone).dayOfWeek;
}

/** yyyy-mm-da no calendário de parede de um instante UTC, para alinhar a grade ao nextRunAt. */
export function ymdInZoneFromUtcInstant(isoUtc: string | undefined, timeZone: string): string | null {
  if (!isoUtc) return null;
  const ms = Date.parse(isoUtc);
  if (Number.isNaN(ms)) return null;
  return formatZonedYmdHmKey(ms, timeZone).split('|')[0] ?? null;
}

function zonedWallClock(utcMs: number, timeZone: string): {
  dayOfWeek: number;
  hour: number;
  minute: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value || '';
  const wk = get('weekday');
  const dayOfWeek = WEEKDAY_FROM_FORMAT[wk] ?? 0;
  const h = Math.min(23, Math.max(0, parseInt(get('hour'), 10) || 0));
  const m = Math.min(59, Math.max(0, parseInt(get('minute'), 10) || 0));
  return { dayOfWeek, hour: h, minute: m };
}

function parseHm(t: string): { h: number; m: number } | null {
  const s = t.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!match) return null;
  const h = Math.min(23, Math.max(0, parseInt(match[1], 10)));
  const m = Math.min(59, Math.max(0, parseInt(match[2], 10)));
  return { h, m };
}

/**
 * Próximo instante (ISO UTC) em que algum slot coincide com o relógio de parede no fuso
 * informado, estritamente após `afterMs` (por minuto, até ~21 dias).
 */
export function computeNextRunIso(
  slots: CampaignScheduleSlot[],
  timeZone: string,
  afterMs: number
): string | null {
  if (!slots.length || !timeZone) return null;
  const normalized = slots
    .map((s) => ({
      dayOfWeek: Math.min(6, Math.max(0, Math.floor(Number(s.dayOfWeek) || 0))),
      hm: parseHm(s.time)
    }))
    .filter((s) => s.hm !== null) as { dayOfWeek: number; hm: { h: number; m: number } }[];
  if (!normalized.length) return null;

  let t = Math.ceil(afterMs / 60000) * 60000;
  const limit = afterMs + 21 * 24 * 60 * 60 * 1000;
  while (t < limit) {
    const w = zonedWallClock(t, timeZone);
    for (const s of normalized) {
      if (s.dayOfWeek === w.dayOfWeek && s.hm.h === w.hour && s.hm.m === w.minute) {
        return new Date(t).toISOString();
      }
    }
    t += 60_000;
  }
  return null;
}

const DAY_SHORT_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

export function formatScheduleSlotLine(slot: CampaignScheduleSlot): string {
  const d = DAY_SHORT_PT[slot.dayOfWeek] ?? `D${slot.dayOfWeek}`;
  return `${d} ${slot.time}`;
}

export function buildWeekAgendaText(slots: CampaignScheduleSlot[], timeZone: string | undefined): string {
  if (!slots.length) return 'Sem horários';
  const lines = slots.map((s) => formatScheduleSlotLine(s)).join(' · ');
  return timeZone ? `${lines} (${timeZone})` : lines;
}
