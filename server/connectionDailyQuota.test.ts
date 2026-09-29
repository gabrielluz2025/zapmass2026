import { describe, expect, it } from 'vitest';
import {
  alignDailyLimitToAchieved,
  channelHasDailySendRoom,
  checkAndResetDailyLimitsWithDeps,
  consumeDailyCampaignQuota,
  getEffectiveMessagesSentToday,
  releaseDailyCampaignQuota,
  resolveEffectiveChannelQuota,
  setConnectionPgSentTodayFloor,
  userDailyLimitOverridesTierCap,
} from './connectionDailyQuota.js';

describe('connectionDailyQuota', () => {
  it('não deixa passar do limite com reservas serializadas', async () => {
    const store = new Map<string, { dailyLimit: number; messagesSentToday: number; instanceName: string }>();
    store.set('c1', { dailyLimit: 40, messagesSentToday: 38, instanceName: 'c1' });
    const deps = {
      getConnection: (id: string) => store.get(id),
      brazilTodayKey: () => '2026-09-23',
      onResetPersist: () => {},
      onConsumePersist: () => {},
    };

    const results = await Promise.all([
      consumeDailyCampaignQuota('c1', deps),
      consumeDailyCampaignQuota('c1', deps),
      consumeDailyCampaignQuota('c1', deps),
      consumeDailyCampaignQuota('c1', deps),
    ]);
    expect(results.filter((r) => r === 'ok').length).toBe(2);
    expect(results.filter((r) => r === 'blocked').length).toBe(2);
    expect(store.get('c1')!.messagesSentToday).toBe(40);
  });

  it('usa piso do PG quando RAM está atrás', () => {
    setConnectionPgSentTodayFloor('c2', 39);
    const store = new Map<string, { dailyLimit: number; messagesSentToday: number; instanceName: string }>();
    store.set('c2', { dailyLimit: 40, messagesSentToday: 10, instanceName: 'c2' });
    const deps = {
      getConnection: (id: string) => store.get(id),
      brazilTodayKey: () => '2026-09-23',
      onResetPersist: () => {},
      onConsumePersist: () => {},
    };
    expect(getEffectiveMessagesSentToday('c2', deps)).toBe(39);
  });

  it('release devolve vaga após falha de envio', async () => {
    const store = new Map<string, { dailyLimit: number; messagesSentToday: number; instanceName: string }>();
    store.set('c3', { dailyLimit: 40, messagesSentToday: 39, instanceName: 'c3' });
    const deps = {
      getConnection: (id: string) => store.get(id),
      brazilTodayKey: () => '2026-09-23',
      onResetPersist: () => {},
      onConsumePersist: () => {},
    };
    expect(await consumeDailyCampaignQuota('c3', deps)).toBe('ok');
    await releaseDailyCampaignQuota('c3', deps);
    expect(store.get('c3')!.messagesSentToday).toBe(39);
  });

  it('sobe a meta para o volume já disparado sem abrir vaga extra', () => {
    const conn = { dailyLimit: 20, messagesSentToday: 81, instanceName: 'c4' };
    expect(alignDailyLimitToAchieved(conn, 81, '2026-09-28')).toBe(true);
    expect(conn.dailyLimit).toBe(81);
    expect(conn.messagesSentToday).toBe(81);
    expect(alignDailyLimitToAchieved(conn, 81, '2026-09-28')).toBe(false);
  });

  it('não reescreve meta alterada na mão nem envio extra aprovado no mesmo dia', () => {
    const manual = { dailyLimit: 20, messagesSentToday: 81, dailyLimitManualOn: '2026-09-28', instanceName: 'c5' };
    expect(alignDailyLimitToAchieved(manual, 81, '2026-09-28')).toBe(false);
    expect(manual.dailyLimit).toBe(20);

    const approved = { dailyLimit: 20, messagesSentToday: 81, limitExceededApproved: true, instanceName: 'c6' };
    expect(alignDailyLimitToAchieved(approved, 81, '2026-09-28')).toBe(false);
    expect(approved.dailyLimit).toBe(20);
  });

  it('no dia seguinte a meta ajustada permanece e o contador zera', () => {
    const conn = {
      dailyLimit: 81,
      messagesSentToday: 81,
      dailyLimitManualOn: '2026-09-28',
      lastLimitResetDate: '2026-09-28',
      growthRate: 0,
      instanceName: 'c7',
    };
    checkAndResetDailyLimitsWithDeps(conn, {
      getConnection: () => conn,
      brazilTodayKey: () => '2026-09-29',
      onResetPersist: () => {},
      onConsumePersist: () => {},
    });
    expect(conn.dailyLimit).toBe(81);
    expect(conn.messagesSentToday).toBe(0);
    expect(conn.dailyLimitManualOn).toBeUndefined();
  });

  it('abrir a meta acima do enviado libera vaga; no teto continua fechado', () => {
    expect(channelHasDailySendRoom({ dailyLimit: 20, messagesSentToday: 20 })).toBe(false);
    expect(channelHasDailySendRoom({ dailyLimit: 80, messagesSentToday: 20 })).toBe(true);
    expect(channelHasDailySendRoom({ dailyLimit: 0, messagesSentToday: 80 })).toBe(true);
    expect(
      channelHasDailySendRoom({ dailyLimit: 20, messagesSentToday: 80, limitExceededApproved: true })
    ).toBe(true);
  });

  it('meta do canal maior que o teto do tier manda no disparo', () => {
    expect(userDailyLimitOverridesTierCap(300, 250)).toBe(true);
    expect(userDailyLimitOverridesTierCap(20, 250)).toBe(false);
    expect(userDailyLimitOverridesTierCap(0, 20)).toBe(false);
    expect(userDailyLimitOverridesTierCap(100, 0)).toBe(true);
  });

  it('resolveEffectiveChannelQuota aplica teto do canal sobre a cota da campanha', () => {
    // Campanha 100, canal 40 -> 40
    expect(resolveEffectiveChannelQuota(100, 40)).toBe(40);
    // Campanha 100, canal 150 -> 100
    expect(resolveEffectiveChannelQuota(100, 150)).toBe(100);
    // Campanha 100, canal sem limite (0 ou indefinido) -> 100
    expect(resolveEffectiveChannelQuota(100, 0)).toBe(100);
    expect(resolveEffectiveChannelQuota(100, undefined)).toBe(100);
  });
});
