import { describe, expect, it } from 'vitest';
import { isRedisStressError } from './redisBullmqResilience.js';

describe('isRedisStressError', () => {
  it('detecta OOM do Redis', () => {
    expect(
      isRedisStressError(new Error("OOM command not allowed when used memory > 'maxmemory'"))
    ).toBe(true);
  });

  it('detecta stream não gravável (enableOfflineQueue false)', () => {
    expect(
      isRedisStressError(new Error("Stream isn't writeable and enableOfflineQueue options is false"))
    ).toBe(true);
  });

  it('ignora erros comuns de rede', () => {
    expect(isRedisStressError(new Error('connect ETIMEDOUT'))).toBe(false);
    expect(isRedisStressError(new Error('Connection is closed'))).toBe(false);
  });
});
