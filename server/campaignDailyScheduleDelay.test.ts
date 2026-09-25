import { describe, expect, it } from 'vitest';
import {
  BRAZIL_OFFSET_MS,
  brazilMidnightUtcMs,
  calendarDaysUntilWorkDay,
  computeDailyScheduleDelayMs,
  computeEffectiveChannelDailyLimit,
  computePeriodQuotas,
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

  describe('limite diário próprio do canal como teto e divisão por período', () => {
    it('computeEffectiveChannelDailyLimit: limite do canal prevalece quando menor que da campanha', () => {
      // Cenário do usuário: campanha 100 msg/dia, canal com limite de 40 msg/dia
      expect(computeEffectiveChannelDailyLimit(100, 40)).toBe(40);
      // Se canal tem limite maior (ex: 150), respeita a restrição menor da campanha (100)
      expect(computeEffectiveChannelDailyLimit(100, 150)).toBe(100);
      // Se canal não tem limite próprio configurado (0, null ou undefined), usa o da campanha
      expect(computeEffectiveChannelDailyLimit(100, 0)).toBe(100);
      expect(computeEffectiveChannelDailyLimit(100, null)).toBe(100);
      expect(computeEffectiveChannelDailyLimit(100, undefined)).toBe(100);
    });

    it('computePeriodQuotas: divide a cota efetiva proporcionalmente entre manhã e tarde (50%/50% de 40 vira 20/20)', () => {
      // Cenário: canal com teto de 40 mensagens, 50% manhã e 50% tarde
      const quotas = computePeriodQuotas(40, [
        { pct: 50, startHour: 8, endHour: 12 },
        { pct: 50, startHour: 13, endHour: 18 },
      ]);
      expect(quotas).toHaveLength(2);
      expect(quotas[0].quota).toBe(20); // 20 de manhã
      expect(quotas[1].quota).toBe(20); // 20 à tarde
    });

    it('computePeriodQuotas: divide cota de 100 mensagens (50 manhã / 50 tarde)', () => {
      const quotas = computePeriodQuotas(100, [
        { pct: 50, startHour: 8, endHour: 12 },
        { pct: 50, startHour: 13, endHour: 18 },
      ]);
      expect(quotas[0].quota).toBe(50);
      expect(quotas[1].quota).toBe(50);
    });

    it('computeDailyScheduleDelayMs: aplica o teto do canal (40 msg) dividindo em 20 manhã e 20 tarde', () => {
      // Quinta-feira 07:00 BRT (antes da janela da manhã)
      const morningBeforeNow = Date.UTC(2026, 7, 13, 10, 0, 0); // 10h UTC = 7h BRT

      // Contato 0 (primeiro da manhã): deve cair no início da manhã (8h)
      const delayContact0 = computeDailyScheduleDelayMs({
        nowMs: morningBeforeNow,
        dayIndex: 0,
        contactIndexInDay: 0,
        intraDayStaggerMs: 0,
        timePeriodEnabled: true,
        periods: [
          { pct: 50, startHour: 8, endHour: 12 },
          { pct: 50, startHour: 13, endHour: 18 },
        ],
        dayLimit: 100, // configurado na campanha
        channelDailyLimit: 40, // teto do canal
      });
      const hourContact0 = new Date(morningBeforeNow + delayContact0 - BRAZIL_OFFSET_MS).getUTCHours();
      expect(hourContact0).toBe(8);

      // Contato 19 (último da cota de 20 da manhã): deve ainda cair no período da manhã (< 12h)
      const delayContact19 = computeDailyScheduleDelayMs({
        nowMs: morningBeforeNow,
        dayIndex: 0,
        contactIndexInDay: 19,
        intraDayStaggerMs: 0,
        timePeriodEnabled: true,
        periods: [
          { pct: 50, startHour: 8, endHour: 12 },
          { pct: 50, startHour: 13, endHour: 18 },
        ],
        dayLimit: 100,
        channelDailyLimit: 40,
      });
      const hourContact19 = new Date(morningBeforeNow + delayContact19 - BRAZIL_OFFSET_MS).getUTCHours();
      expect(hourContact19).toBeGreaterThanOrEqual(8);
      expect(hourContact19).toBeLessThan(12);

      // Contato 20 (21º contato, primeiro da cota da tarde): DEVE cair no período da tarde (>= 13h)
      // Se não houvesse o teto de 40, contato 20 ainda cairia na manhã (pois 20 < 50)
      const delayContact20 = computeDailyScheduleDelayMs({
        nowMs: morningBeforeNow,
        dayIndex: 0,
        contactIndexInDay: 20,
        intraDayStaggerMs: 0,
        timePeriodEnabled: true,
        periods: [
          { pct: 50, startHour: 8, endHour: 12 },
          { pct: 50, startHour: 13, endHour: 18 },
        ],
        dayLimit: 100,
        channelDailyLimit: 40,
      });
      const hourContact20 = new Date(morningBeforeNow + delayContact20 - BRAZIL_OFFSET_MS).getUTCHours();
      expect(hourContact20).toBeGreaterThanOrEqual(13);
      expect(hourContact20).toBeLessThan(18);

      // Contato 39 (último contato do dia no canal): cai na tarde (< 18h)
      const delayContact39 = computeDailyScheduleDelayMs({
        nowMs: morningBeforeNow,
        dayIndex: 0,
        contactIndexInDay: 39,
        intraDayStaggerMs: 0,
        timePeriodEnabled: true,
        periods: [
          { pct: 50, startHour: 8, endHour: 12 },
          { pct: 50, startHour: 13, endHour: 18 },
        ],
        dayLimit: 100,
        channelDailyLimit: 40,
      });
      const hourContact39 = new Date(morningBeforeNow + delayContact39 - BRAZIL_OFFSET_MS).getUTCHours();
      expect(hourContact39).toBeGreaterThanOrEqual(13);
      expect(hourContact39).toBeLessThan(18);
    });
  });
});
