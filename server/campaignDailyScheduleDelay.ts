/** Atraso do cronograma diário em relógio de Brasília (UTC−3), não “N horas a partir de agora”. */

export const BRAZIL_OFFSET_MS = 3 * 3600_000;
const DAY_MS = 86_400_000;

/** Sem período no wizard: dispara só em horário comercial de Brasília. */
export const DEFAULT_DISPATCH_START_HOUR = 8;
export const DEFAULT_DISPATCH_END_HOUR = 20;

export type DailySchedulePeriod = {
  pct: number;
  startHour: number;
  endHour: number;
};

export type DailyScheduleWindow = {
  enabled?: boolean;
  allowedWeekdays?: number[];
  timePeriodEnabled?: boolean;
  periods?: DailySchedulePeriod[];
};

export function brazilWallParts(nowMs: number): {
  year: number;
  month: number;
  date: number;
  hour: number;
  minute: number;
  dow: number;
} {
  const br = new Date(nowMs - BRAZIL_OFFSET_MS);
  return {
    year: br.getUTCFullYear(),
    month: br.getUTCMonth(),
    date: br.getUTCDate(),
    hour: br.getUTCHours(),
    minute: br.getUTCMinutes(),
    dow: br.getUTCDay(),
  };
}

/** Meia-noite de Brasília do dia civil atual, em epoch UTC. */
export function brazilMidnightUtcMs(nowMs: number): number {
  const p = brazilWallParts(nowMs);
  return Date.UTC(p.year, p.month, p.date, 0, 0, 0, 0) + BRAZIL_OFFSET_MS;
}

function normalizeAllowedWeekdays(allowedWeekdays?: number[]): number[] | null {
  return Array.isArray(allowedWeekdays) &&
    allowedWeekdays.length > 0 &&
    allowedWeekdays.length < 7
    ? allowedWeekdays
    : null;
}

export function resolveDispatchPeriods(schedule?: DailyScheduleWindow | null): DailySchedulePeriod[] {
  if (
    schedule?.timePeriodEnabled &&
    Array.isArray(schedule.periods) &&
    schedule.periods.length > 0
  ) {
    const cleaned = schedule.periods
      .map((p) => ({
        pct: Number(p?.pct) || 0,
        startHour: Math.max(0, Math.min(23, Math.floor(Number(p?.startHour)))),
        endHour: Math.max(0, Math.min(24, Math.floor(Number(p?.endHour)))),
      }))
      .filter((p) => p.endHour > p.startHour);
    if (cleaned.length > 0) return cleaned;
  }
  return [
    {
      pct: 100,
      startHour: DEFAULT_DISPATCH_START_HOUR,
      endHour: DEFAULT_DISPATCH_END_HOUR,
    },
  ];
}

function isAllowedDow(dow: number, allowed: number[] | null): boolean {
  return !allowed || allowed.includes(dow);
}

/** True se agora (Brasília) está dentro de alguma janela e num dia permitido. */
export function isWithinDailyScheduleWindow(
  nowMs: number,
  schedule?: DailyScheduleWindow | null
): boolean {
  if (!schedule?.enabled) return true;
  const allowed = normalizeAllowedWeekdays(schedule.allowedWeekdays);
  const parts = brazilWallParts(nowMs);
  if (!isAllowedDow(parts.dow, allowed)) return false;
  const hourFrac = parts.hour + parts.minute / 60;
  return resolveDispatchPeriods(schedule).some(
    (p) => hourFrac >= p.startHour && hourFrac < p.endHour
  );
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
  const allowed = normalizeAllowedWeekdays(allowedWeekdays);
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

function nextAllowedCalDayAfter(
  nowMs: number,
  afterCalDay: number,
  allowedWeekdays?: number[]
): number {
  const allowed = normalizeAllowedWeekdays(allowedWeekdays);
  const midnight0 = brazilMidnightUtcMs(nowMs);
  for (let cal = afterCalDay + 1; cal <= afterCalDay + 21; cal++) {
    const dow = brazilWallParts(midnight0 + cal * DAY_MS).dow;
    if (isAllowedDow(dow, allowed)) return cal;
  }
  return afterCalDay + 1;
}

/** ms até o início da próxima janela permitida (0 = pode enviar agora). */
export function msUntilNextDailyScheduleWindow(
  nowMs: number,
  schedule?: DailyScheduleWindow | null
): number {
  if (!schedule?.enabled) return 0;
  if (isWithinDailyScheduleWindow(nowMs, schedule)) return 0;

  const allowed = normalizeAllowedWeekdays(schedule.allowedWeekdays);
  const periods = resolveDispatchPeriods(schedule);
  const midnight0 = brazilMidnightUtcMs(nowMs);

  for (let cal = 0; cal < 21; cal++) {
    const dayStart = midnight0 + cal * DAY_MS;
    const dow = brazilWallParts(dayStart).dow;
    if (!isAllowedDow(dow, allowed)) continue;
    for (const p of periods) {
      const start = dayStart + p.startHour * 3_600_000;
      const end = dayStart + p.endHour * 3_600_000;
      if (nowMs < start) return start - nowMs;
      if (nowMs >= start && nowMs < end) return 0;
    }
  }
  return 8 * 3_600_000;
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
  const schedule: DailyScheduleWindow = {
    enabled: true,
    allowedWeekdays: opts.allowedWeekdays,
    timePeriodEnabled: opts.timePeriodEnabled,
    periods: opts.periods,
  };
  const calDay = calendarDaysUntilWorkDay(opts.nowMs, opts.dayIndex, opts.allowedWeekdays);
  const dayMidnight = brazilMidnightUtcMs(opts.nowMs) + calDay * DAY_MS;
  const intra = Math.max(0, opts.intraDayStaggerMs);
  const periods = resolveDispatchPeriods(schedule);

  let intended = 0;
  if (opts.timePeriodEnabled && Array.isArray(opts.periods) && opts.periods.length >= 2) {
    const [morning, afternoon] = opts.periods;
    const dayLimit = Math.max(1, opts.dayLimit);
    const morningCount = Math.round((dayLimit * (morning?.pct ?? 50)) / 100);
    const inMorning = opts.contactIndexInDay < morningCount;
    const period = inMorning ? morning : afternoon;
    const periodPos = inMorning
      ? opts.contactIndexInDay
      : opts.contactIndexInDay - morningCount;
    const periodCount = Math.max(
      1,
      inMorning ? Math.max(1, morningCount) : Math.max(1, dayLimit - morningCount)
    );
    const startH = Number(period?.startHour) || DEFAULT_DISPATCH_START_HOUR;
    const endH = Number(period?.endHour) || startH;
    const periodDurMs = Math.max(0, (endH - startH) * 3_600_000);
    const clockMs = startH * 3_600_000 + Math.round((periodDurMs * periodPos) / periodCount);
    intended = dayMidnight + clockMs;
  } else if (calDay === 0 && isWithinDailyScheduleWindow(opts.nowMs, schedule)) {
    intended = opts.nowMs + intra;
  } else {
    const startH = periods[0]?.startHour ?? DEFAULT_DISPATCH_START_HOUR;
    const endH = periods[0]?.endHour ?? DEFAULT_DISPATCH_END_HOUR;
    const windowMs = Math.max(60_000, (endH - startH) * 3_600_000);
    const clockMs = startH * 3_600_000 + Math.min(intra, windowMs - 60_000);
    intended = dayMidnight + clockMs;
  }

  if (intended <= opts.nowMs) {
    const nextCal = nextAllowedCalDayAfter(opts.nowMs, calDay, opts.allowedWeekdays);
    const slotOnDay = intended - dayMidnight;
    intended = brazilMidnightUtcMs(opts.nowMs) + nextCal * DAY_MS + slotOnDay;
  }

  const wait = Math.max(0, intended - opts.nowMs);
  const fireAt = opts.nowMs + wait;
  const extra = msUntilNextDailyScheduleWindow(fireAt, schedule);
  return wait + extra;
}

export function parseCampaignDailySchedule(
  raw: unknown
): DailyScheduleWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (s.enabled !== true && s.enabled !== 'true') return null;
  const periods = Array.isArray(s.periods)
    ? (s.periods as DailySchedulePeriod[])
    : undefined;
  const allowedWeekdays = Array.isArray(s.allowedWeekdays)
    ? (s.allowedWeekdays as number[]).map((n) => Number(n)).filter((n) => n >= 0 && n <= 6)
    : undefined;
  return {
    enabled: true,
    allowedWeekdays,
    timePeriodEnabled: Boolean(s.timePeriodEnabled),
    periods,
  };
}
