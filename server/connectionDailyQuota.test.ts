import { describe, expect, it } from 'vitest';
import {
  consumeDailyCampaignQuota,
  getEffectiveMessagesSentToday,
  releaseDailyCampaignQuota,
  setConnectionPgSentTodayFloor,
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
});
