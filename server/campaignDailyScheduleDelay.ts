/** Atraso do cronograma diário em relógio de Brasília (UTC−3), não “N horas a partir de agora”. */

export const BRAZIL_OFFSET_MS = 3 * 3600_000;
const DAY_MS = 86_400_000;

export type DailySchedulePeriod = {
  pct: number;
  startHour: number;
  endHour: number;
};

export function brazilWallParts(nowMs: number): {
  year: number;
  month: number;
  date: number;
  hour: number;
  dow: number;
} {
  const br = new Date(nowMs - BRAZIL_OFFSET_MS);
  return {
    year: br.getUTCFullYear(),
    month: br.getUTCMonth(),
    date: br.getUTCDate(),
    hour: br.getUTCHours(),
    dow: br.getUTCDay(),
  };
}

/** Meia-noite de Brasília do dia civil atual, em epoch UTC. */
export function brazilMidnightUtcMs(nowMs: number): number {
  const p = brazilWallParts(nowMs);
  return Date.UTC(p.year, p.month, p.date, 0, 0, 0, 0) + BRAZIL_OFFSET_MS;
}

/**
 * Quantos dias de calendário (0 = hoje em Brasília) até o workDayIndex,
 * pulando dias da semana não permitidos. O dia 0 já é o primeiro dia permitido
 * (hoje, se hoje for permitido; senão a próxima data válida).
 */
export function calendarDaysUntilWorkDay(
  nowMs: number,
  workDayIndex: number,
  allowedWeekdays?: number[]
): number {
  const idx = Math.max(0, Math.floor(workDayIndex) || 0);
  const allowed =
    Array.isArray(allowedWeekdays) &&
    allowedWeekdays.length > 0 &&
    allowedWeekdays.length < 7
      ? allowedWeekdays
      : null;
  if (!allowed) return idx;

  const midnight = brazilMidnightUtcMs(nowMs);
  let calDay = 0;
  let guard = 0;
  while (guard++ < 14 && !allowed.includes(brazilWallParts(midnight + calDay * DAY_MS).dow)) {
    calDay++;
  }
  let wDay = 0;
  while (wDay < idx && guard++ < 400) {
    calDay++;
    if (allowed.includes(brazilWallParts(midnight + calDay * DAY_MS).dow)) wDay++;
  }
  return calDay;
}

export function computeDailyScheduleDelayMs(opts: {
  nowMs: number;
  dayIndex: number;
  contactIndexInDay: number;
  intraDayStaggerMs: number;
  allowedWeekdays?: number[];
  timePeriodEnabled?: boolean;
  periods?: DailySchedulePeriod[];
  dayLimit: number;
}): number {
  const calDay = calendarDaysUntilWorkDay(opts.nowMs, opts.dayIndex, opts.allowedWeekdays);
  const dayMidnight = brazilMidnightUtcMs(opts.nowMs) + calDay * DAY_MS;
  const intra = Math.max(0, opts.intraDayStaggerMs);

  if (
    opts.timePeriodEnabled &&
    Array.isArray(opts.periods) &&
    opts.periods.length >= 2
  ) {
    const [morning, afternoon] = opts.periods;
    const dayLimit = Math.max(1, opts.dayLimit);
    const morningCount = Math.round(dayLimit * (morning?.pct ?? 50) / 100);
    const inMorning = opts.contactIndexInDay < morningCount;
    const period = inMorning ? morning : afternoon;
    const periodPos = inMorning
      ? opts.contactIndexInDay
      : opts.contactIndexInDay - morningCount;
    const periodCount = Math.max(
      1,
      inMorning ? Math.max(1, morningCount) : Math.max(1, dayLimit - morningCount)
    );
    const startH = Number(period?.startHour) || 0;
    const endH = Number(period?.endHour) || startH;
    const periodDurMs = Math.max(0, (endH - startH) * 3_600_000);
    const clockMs = startH * 3_600_000 + Math.round((periodDurMs * periodPos) / periodCount);
    const delay = dayMidnight + clockMs - opts.nowMs;
    if (delay > 0) return delay;
    return intra;
  }

  if (calDay === 0) return intra;
  return Math.max(0, dayMidnight + intra - opts.nowMs);
}
