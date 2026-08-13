import { describe, expect, it } from 'vitest';
import {
  BRAZIL_OFFSET_MS,
  brazilMidnightUtcMs,
  calendarDaysUntilWorkDay,
  computeDailyScheduleDelayMs,
} from './campaignDailyScheduleDelay.js';

/** Quinta 13/08/2026 15:00 em Brasília = 18:00 UTC. */
const THU_15H_BR = Date.UTC(2026, 7, 13, 18, 0, 0);

describe('campaignDailyScheduleDelay', () => {
  it('meia-noite de Brasília cai em UTC 03:00 do mesmo dia civil', () => {
    expect(brazilMidnightUtcMs(THU_15H_BR)).toBe(Date.UTC(2026, 7, 13, 3, 0, 0));
  });

  it('dia 0 hoje sem período = só o stagger (não soma 15h de relógio)', () => {
    const delay = computeDailyScheduleDelayMs({
      nowMs: THU_15H_BR,
      dayIndex: 0,
      contactIndexInDay: 3,
      intraDayStaggerMs: 90_000,
      dayLimit: 100,
    });
    expect(delay).toBe(90_000);
  });

  it('dia 1 começa na meia-noite de Brasília do dia seguinte, não 24h a partir de agora', () => {
    const delay = computeDailyScheduleDelayMs({
      nowMs: THU_15H_BR,
      dayIndex: 1,
      contactIndexInDay: 0,
      intraDayStaggerMs: 0,
      dayLimit: 100,
    });
    const fridayMidnight = Date.UTC(2026, 7, 14, 3, 0, 0);
    expect(delay).toBe(fridayMidnight - THU_15H_BR);
    expect(delay).toBeLessThan(24 * 3600_000);
    expect(delay).toBeGreaterThan(8 * 3600_000);
  });

  it('sábado com só dias úteis empurra o dia 0 para segunda', () => {
    const sat15 = Date.UTC(2026, 7, 15, 18, 0, 0);
    const cal = calendarDaysUntilWorkDay(sat15, 0, [1, 2, 3, 4, 5]);
    expect(cal).toBe(2);
    const delay = computeDailyScheduleDelayMs({
      nowMs: sat15,
      dayIndex: 0,
      contactIndexInDay: 0,
      intraDayStaggerMs: 0,
      allowedWeekdays: [1, 2, 3, 4, 5],
      dayLimit: 50,
    });
    expect(delay).toBeGreaterThan(0);
    const monMidnight = brazilMidnightUtcMs(sat15) + 2 * 86_400_000;
    expect(delay).toBe(monMidnight - sat15);
  });

  it('período da manhã já passou: não soma 8h a partir de agora, usa o stagger', () => {
    const delay = computeDailyScheduleDelayMs({
      nowMs: Date.UTC(2026, 7, 13, 16, 0, 0),
      dayIndex: 0,
      contactIndexInDay: 0,
      intraDayStaggerMs: 999_000,
      timePeriodEnabled: true,
      periods: [
        { pct: 50, startHour: 8, endHour: 12 },
        { pct: 50, startHour: 13, endHour: 18 },
      ],
      dayLimit: 10,
    });
    expect(delay).toBe(999_000);
  });

  it('contato da tarde no mesmo dia cai na janela 13h–18h Brasília', () => {
    const now = Date.UTC(2026, 7, 13, 11, 0, 0);
    const delay = computeDailyScheduleDelayMs({
      nowMs: now,
      dayIndex: 0,
      contactIndexInDay: 6,
      intraDayStaggerMs: 0,
      timePeriodEnabled: true,
      periods: [
        { pct: 50, startHour: 8, endHour: 12 },
        { pct: 50, startHour: 13, endHour: 18 },
      ],
      dayLimit: 10,
    });
    expect(delay).toBeGreaterThan(0);
    const fireAt = now + delay;
    const brHour = new Date(fireAt - BRAZIL_OFFSET_MS).getUTCHours();
    expect(brHour).toBeGreaterThanOrEqual(13);
    expect(brHour).toBeLessThan(18);
  });
});
