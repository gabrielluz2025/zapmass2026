import { describe, it, expect } from 'vitest';
import { ConnectionStatus } from '../types';
import type { WhatsAppConnection } from '../types';
import {
  buildChannelDispatchInsights,
  computeChannelDispatchTemp,
  getChannelLastNSentDays
} from './channelDispatchInsights';

const conn = (over: Partial<WhatsAppConnection> = {}): WhatsAppConnection =>
  ({
    id: 'u1__chip1',
    name: 'Chip',
    phoneNumber: '5511999999999',
    status: ConnectionStatus.CONNECTED,
    lastActivity: '',
    queueSize: 0,
    messagesSentToday: 0,
    signalStrength: 'STRONG',
    ...over
  }) as WhatsAppConnection;

describe('channelDispatchInsights', () => {
  it('getChannelLastNSentDays usa contagem ao vivo de hoje', () => {
    const today = new Date();
    const dk = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const days = getChannelLastNSentDays(
      {
        connectionId: 'c1',
        totalSent: 5,
        totalReceived: 0,
        totalFailed: 0,
        dailyHistory: [{ date: dk, sent: 2, received: 0, failed: 0 }]
      },
      1,
      9
    );
    expect(days[0].sent).toBe(9);
  });

  it('computeChannelDispatchTemp classifica quente com alto volume', () => {
    const last7 = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-06-0${i + 1}`,
      sent: i === 6 ? 50 : 10
    }));
    const t = computeChannelDispatchTemp(50, last7);
    expect(t.temp).toBe('hot');
    expect(t.label).toBe('Quente');
  });

  it('buildChannelDispatchInsights agrega semana', () => {
    const today = new Date();
    const dk = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const row = buildChannelDispatchInsights(
      conn({ messagesSentToday: 12 }),
      {
        connectionId: 'c1',
        totalSent: 12,
        totalReceived: 0,
        totalFailed: 0,
        dailyHistory: [{ date: dk, sent: 5, received: 0, failed: 0 }]
      }
    );
    expect(row.sentToday).toBe(12);
    expect(row.weekTotal).toBeGreaterThanOrEqual(12);
  });
});
