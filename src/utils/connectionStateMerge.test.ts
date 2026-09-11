import { describe, expect, it } from 'vitest';
import { ConnectionStatus, type WhatsAppConnection } from '../types';
import { mergeConnectionStatus, mergeWhatsAppConnectionLists, connectionListLooksUnchanged } from './connectionStateMerge';

describe('mergeConnectionStatus', () => {
  it('mantém CONNECTED em DISCONNECTED transitório (<120s)', () => {
    const since = Date.now() - 30_000;
    expect(
      mergeConnectionStatus(ConnectionStatus.DISCONNECTED, ConnectionStatus.CONNECTED, {
        connectedSince: since,
      })
    ).toBe(ConnectionStatus.CONNECTED);
  });

  it('mantém CONNECTED em QR_READY durante reconexão', () => {
    expect(
      mergeConnectionStatus(ConnectionStatus.QR_READY, ConnectionStatus.CONNECTED, {
        connectedSince: Date.now() - 60_000,
        phoneNumber: '55479990000',
      })
    ).toBe(ConnectionStatus.CONNECTED);
  });

  it('mantém CONNECTED pareado sem connectedSince (corrida hydrate)', () => {
    expect(
      mergeConnectionStatus(ConnectionStatus.DISCONNECTED, ConnectionStatus.CONNECTED, {
        phoneNumber: '55479990000',
      })
    ).toBe(ConnectionStatus.CONNECTED);
  });

  it('aplica DISCONNECTED após grace expirar', () => {
    const since = Date.now() - 130_000;
    expect(
      mergeConnectionStatus(ConnectionStatus.DISCONNECTED, ConnectionStatus.CONNECTED, {
        connectedSince: since,
        phoneNumber: '55479990000',
      })
    ).toBe(ConnectionStatus.DISCONNECTED);
  });
});

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

  it('ignora reordenação com mesmos dados (evita piscar na UI)', () => {
    const a = [base(), { ...base(), id: 'c2', name: 'Chip 2' }];
    const b = [a[1], a[0]];
    expect(connectionListLooksUnchanged(a, b)).toBe(true);
  });

  it('preserva telefone quando payload incompleto (evita offline falso)', () => {
    const prev: WhatsAppConnection = { ...base(), phoneNumber: '55479990000' };
    const inc: WhatsAppConnection = { ...base(), phoneNumber: '' };
    const merged = mergeWhatsAppConnectionLists([inc], [prev], {});
    expect(merged[0]?.phoneNumber).toBe('55479990000');
  });

  it('carimba connectedSince ao ficar CONNECTED sem timestamp', () => {
    const prev: WhatsAppConnection = { ...base(), status: ConnectionStatus.CONNECTING };
    const inc: WhatsAppConnection = { ...base(), status: ConnectionStatus.CONNECTED };
    const merged = mergeWhatsAppConnectionLists([inc], [prev], {});
    expect(merged[0]?.connectedSince).toBeGreaterThan(0);
  });
});
