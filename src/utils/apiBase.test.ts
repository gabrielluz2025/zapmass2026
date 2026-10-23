import { afterEach, describe, expect, it, vi } from 'vitest';

describe('getApiOrigin', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('em app.zap-mass.com usa VITE_API_ORIGIN quando aponta para o apex', async () => {
    vi.stubGlobal('window', {
      location: {
        hostname: 'app.zap-mass.com',
        origin: 'https://app.zap-mass.com'
      }
    });
    vi.stubEnv('VITE_API_ORIGIN', 'https://zap-mass.com');
    const { getApiOrigin } = await import('./apiBase');
    expect(getApiOrigin()).toBe('https://zap-mass.com');
  });

  it('em zap-mass.com ignora VITE_API_ORIGIN igual ou ausente e usa mesma origem', async () => {
    vi.stubGlobal('window', {
      location: {
        hostname: 'zap-mass.com',
        origin: 'https://zap-mass.com'
      }
    });
    vi.stubEnv('VITE_API_ORIGIN', 'https://zap-mass.com');
    const { getApiOrigin } = await import('./apiBase');
    expect(getApiOrigin()).toBe('https://zap-mass.com');
  });
});
