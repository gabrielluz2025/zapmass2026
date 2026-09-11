import { describe, expect, it, beforeEach } from 'vitest';
import type { Request } from 'express';
import {
  getInternalMonitorKey,
  hasInternalMonitorSecret,
  isChipHealthMonitorInternalAccess,
  isLoopbackRequest,
} from './chipHealthMonitorAuth.js';

function mockReq(params: {
  ip?: string;
  headers?: Record<string, string>;
  authorization?: string;
}): Request {
  return {
    socket: { remoteAddress: params.ip ?? '127.0.0.1' },
    headers: {
      ...(params.authorization ? { authorization: params.authorization } : {}),
      ...params.headers,
    },
  } as Request;
}

describe('chipHealthMonitorAuth', () => {
  beforeEach(() => {
    delete process.env.ZAPMASS_INTERNAL_MONITOR_KEY;
    delete process.env.INTERNAL_MONITOR_KEY;
  });

  it('detecta loopback IPv4 e IPv6', () => {
    expect(isLoopbackRequest(mockReq({ ip: '127.0.0.1' }))).toBe(true);
    expect(isLoopbackRequest(mockReq({ ip: '::1' }))).toBe(true);
    expect(isLoopbackRequest(mockReq({ ip: '::ffff:127.0.0.1' }))).toBe(true);
    expect(isLoopbackRequest(mockReq({ ip: '203.0.113.1' }))).toBe(false);
  });

  it('valida X-Internal-Secret quando chave configurada', () => {
    process.env.ZAPMASS_INTERNAL_MONITOR_KEY = 'test-secret-key';
    expect(getInternalMonitorKey()).toBe('test-secret-key');
    expect(
      hasInternalMonitorSecret(
        mockReq({ ip: '203.0.113.1', headers: { 'x-internal-secret': 'test-secret-key' } })
      )
    ).toBe(true);
    expect(
      hasInternalMonitorSecret(
        mockReq({ ip: '203.0.113.1', headers: { 'x-internal-secret': 'wrong' } })
      )
    ).toBe(false);
  });

  it('loopback permite acesso interno sem JWT', () => {
    expect(isChipHealthMonitorInternalAccess(mockReq({ ip: '127.0.0.1' }))).toBe(true);
  });
});
