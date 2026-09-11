import { describe, expect, it } from 'vitest';
import {
  buildProxyUrl,
  getProxyEditLock,
  isDatacenterEgress,
  isProxyDispatchBlocked,
} from './proxyHealthMonitor.js';

describe('proxyHealthMonitor', () => {
  it('buildProxyUrl inclui auth e protocolo', () => {
    expect(
      buildProxyUrl({
        host: 'proxy.example',
        port: 8080,
        protocol: 'socks5',
        username: 'user',
        password: 'pass',
      })
    ).toBe('socks5://user:pass@proxy.example:8080');
  });

  it('isDatacenterEgress detecta hosting e ASNs conhecidos', () => {
    expect(isDatacenterEgress({ hosting: true })).toBe(true);
    expect(isDatacenterEgress({ as: 'AS16509 Amazon.com' })).toBe(true);
    expect(isDatacenterEgress({ isp: 'Residential ISP' })).toBe(false);
  });

  it('getProxyEditLock bloqueia chips novos com proxy', () => {
    const lock = getProxyEditLock({
      hasProxy: true,
      connectedSinceMs: Date.now() - 2 * 86_400_000,
    });
    expect(lock.locked).toBe(true);
    expect(lock.daysLeft).toBeGreaterThan(0);
  });

  it('getProxyEditLock libera após 7 dias', () => {
    const lock = getProxyEditLock({
      hasProxy: true,
      connectedSinceMs: Date.now() - 8 * 86_400_000,
    });
    expect(lock.locked).toBe(false);
  });

  it('isProxyDispatchBlocked só para PROXY_DOWN', () => {
    expect(isProxyDispatchBlocked('chip-x')).toBe(false);
  });
});
