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
