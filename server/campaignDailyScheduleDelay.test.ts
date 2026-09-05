import { describe, expect, it } from 'vitest';
import {
  BRAZIL_OFFSET_MS,
  brazilMidnightUtcMs,
  calendarDaysUntilWorkDay,
  computeDailyScheduleDelayMs,
  isWithinDailyScheduleWindow,
  msUntilNextDailyScheduleWindow,
} from './campaignDailyScheduleDelay.js';

/** Quinta 13/08/2026 15:00 em Brasília = 18:00 UTC. */
const THU_15H_BR = Date.UTC(2026, 7, 13, 18, 0, 0);
/** Sexta 14/08/2026 00:29 em Brasília = 03:29 UTC. */
const FRI_0029_BR = Date.UTC(2026, 7, 14, 3, 29, 0);

const BUSINESS_SCHEDULE = {
  enabled: true,
  timePeriodEnabled: true,
  periods: [
    { pct: 50, startHour: 8, endHour: 12 },
    { pct: 50, startHour: 13, endHour: 18 },
  ],
};

describe('campaignDailyScheduleDelay', () => {
  it('meia-noite de Brasília cai em UTC 03:00 do mesmo dia civil', () => {
    expect(brazilMidnightUtcMs(THU_15H_BR)).toBe(Date.UTC(2026, 7, 13, 3, 0, 0));
  });

  it('00:29 Brasília está fora da janela e espera até as 8h', () => {
    expect(isWithinDailyScheduleWindow(FRI_0029_BR, BUSINESS_SCHEDULE)).toBe(false);
    const wait = msUntilNextDailyScheduleWindow(FRI_0029_BR, BUSINESS_SCHEDULE);
    const fireAt = FRI_0029_BR + wait;
    const brHour = new Date(fireAt - BRAZIL_OFFSET_MS).getUTCHours();
    expect(brHour).toBe(8);
    expect(wait).toBeGreaterThan(7 * 3600_000);
    expect(wait).toBeLessThan(8 * 3600_000);
  });

  it('15h Brasília sem período = só o stagger (ainda dentro de 8h–20h)', () => {
    const delay = computeDailyScheduleDelayMs({
      nowMs: THU_15H_BR,
      dayIndex: 0,
      contactIndexInDay: 3,
      intraDayStaggerMs: 90_000,
      dayLimit: 100,
    });
    expect(delay).toBe(90_000);
  });

  it('dia 1 começa às 8h de Brasília do dia seguinte, nunca à meia-noite', () => {
    const delay = computeDailyScheduleDelayMs({
      nowMs: THU_15H_BR,
      dayIndex: 1,
      contactIndexInDay: 0,
      intraDayStaggerMs: 0,
      dayLimit: 100,
    });
    const friday8am = Date.UTC(2026, 7, 14, 11, 0, 0);
    expect(delay).toBe(friday8am - THU_15H_BR);
    const fireHour = new Date(THU_15H_BR + delay - BRAZIL_OFFSET_MS).getUTCHours();
    expect(fireHour).toBe(8);
  });

  it('sábado com só dias úteis empurra o dia 0 para segunda 8h', () => {
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
    const fireHour = new Date(sat15 + delay - BRAZIL_OFFSET_MS).getUTCHours();
    expect(fireHour).toBe(8);
  });

  it('período da manhã já passou: vai para o mesmo horário no próximo dia útil', () => {
    const now = Date.UTC(2026, 7, 13, 16, 0, 0);
    const delay = computeDailyScheduleDelayMs({
      nowMs: now,
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
    const fireAt = now + delay;
    const br = new Date(fireAt - BRAZIL_OFFSET_MS);
    expect(br.getUTCHours()).toBe(8);
    expect(br.getUTCDate()).toBe(14);
  });

  it('parseCampaignDailySchedule lê o doc da campanha', async () => {
    const { parseCampaignDailySchedule } = await import('./campaignDailyScheduleDelay.js');
    expect(parseCampaignDailySchedule({ enabled: true, timePeriodEnabled: true, periods: BUSINESS_SCHEDULE.periods })).toMatchObject({
      enabled: true,
      timePeriodEnabled: true,
    });
    expect(parseCampaignDailySchedule({ enabled: false })).toBeNull();
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
