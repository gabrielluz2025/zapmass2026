import { describe, expect, it } from 'vitest';
import { ConnectionStatus, type WhatsAppConnection } from '../types';
import { mergeWhatsAppConnectionLists } from './connectionStateMerge';

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
