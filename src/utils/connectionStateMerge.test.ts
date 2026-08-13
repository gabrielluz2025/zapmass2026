import { describe, expect, it } from 'vitest';
import { ConnectionStatus, type WhatsAppConnection } from '../types';
import { mergeWhatsAppConnectionLists, connectionListLooksUnchanged } from './connectionStateMerge';

describe('mergeWhatsAppConnectionLists', () => {
  it('preserva canais anteriores ausentes no payload do servidor', () => {
    const zapMass: WhatsAppConnection = {
      id: 'conn_zap',
      name: 'Zap-mass',
      status: ConnectionStatus.DISCONNECTED,
      phoneNumber: '554788509311',
      lastActivity: '',
      queueSize: 0,
      messagesSentToday: 0,
      signalStrength: 'STRONG',
      batteryLevel: 100
    };
    const gabriel: WhatsAppConnection = {
      id: 'conn_gab',
      name: 'Gabriel',
      status: ConnectionStatus.CONNECTED,
      phoneNumber: '554799127001',
      lastActivity: '',
      queueSize: 0,
      messagesSentToday: 0,
      signalStrength: 'STRONG',
      batteryLevel: 100
    };
    const merged = mergeWhatsAppConnectionLists([gabriel], [zapMass, gabriel], {});
    expect(merged.map((c) => c.id).sort()).toEqual(['conn_gab', 'conn_zap']);
  });
});

describe('connectionListLooksUnchanged', () => {
  const base = (): WhatsAppConnection => ({
    id: 'c1',
    name: 'Chip',
    status: ConnectionStatus.CONNECTED,
    phoneNumber: '55479990000',
    lastActivity: '',
    queueSize: 0,
    messagesSentToday: 0,
    signalStrength: 'STRONG',
    batteryLevel: 100
  });

  it('detecta mudança em messagesSentToday (parabéns / chat)', () => {
    const a = [base()];
    const b = [{ ...base(), messagesSentToday: 3 }];
    expect(connectionListLooksUnchanged(a, b)).toBe(false);
  });

  it('detecta mudança em queueSize', () => {
    const a = [base()];
    const b = [{ ...base(), queueSize: 12 }];
    expect(connectionListLooksUnchanged(a, b)).toBe(false);
  });

  it('ignora quando só a referência muda', () => {
    const a = [base()];
    const b = [{ ...base() }];
    expect(connectionListLooksUnchanged(a, b)).toBe(true);
  });
});
