import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCachedNumberId,
  setCachedNumberId,
  invalidateCachedNumber,
  clearCacheForConnection,
} from './contactCache';

// Reseta o módulo entre testes para isolar o estado do Map
beforeEach(() => {
  clearCacheForConnection('conn1');
  clearCacheForConnection('conn2');
});

describe('contactCache', () => {
  it('retorna null quando não há entrada', () => {
    expect(getCachedNumberId('conn1', '5511999990001')).toBeNull();
  });

  it('armazena e recupera um numberId', () => {
    setCachedNumberId('conn1', '5511999990001', '5511999990001@c.us');
    expect(getCachedNumberId('conn1', '5511999990001')).toBe('5511999990001@c.us');
  });

  it('isola entradas por connectionId (sem colisão entre chips)', () => {
    setCachedNumberId('conn1', '5511999990002', 'jid-conn1');
    setCachedNumberId('conn2', '5511999990002', 'jid-conn2');
    expect(getCachedNumberId('conn1', '5511999990002')).toBe('jid-conn1');
    expect(getCachedNumberId('conn2', '5511999990002')).toBe('jid-conn2');
  });

  it('invalidateCachedNumber remove apenas o par connectionId+phone', () => {
    setCachedNumberId('conn1', '5511999990003', 'jid-a');
    setCachedNumberId('conn1', '5511999990004', 'jid-b');
    invalidateCachedNumber('conn1', '5511999990003');
    expect(getCachedNumberId('conn1', '5511999990003')).toBeNull();
    expect(getCachedNumberId('conn1', '5511999990004')).toBe('jid-b');
  });

  it('clearCacheForConnection remove apenas entradas do canal informado', () => {
    setCachedNumberId('conn1', '5511999990005', 'jid-x');
    setCachedNumberId('conn2', '5511999990005', 'jid-y');
    clearCacheForConnection('conn1');
    expect(getCachedNumberId('conn1', '5511999990005')).toBeNull();
    expect(getCachedNumberId('conn2', '5511999990005')).toBe('jid-y');
  });

  it('retorna null após TTL expirado', async () => {
    vi.useFakeTimers();
    setCachedNumberId('conn1', '5511999990006', 'jid-ttl');
    expect(getCachedNumberId('conn1', '5511999990006')).toBe('jid-ttl');
    // Avança 25 horas (além do TTL de 24h)
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    expect(getCachedNumberId('conn1', '5511999990006')).toBeNull();
    vi.useRealTimers();
  });
});
