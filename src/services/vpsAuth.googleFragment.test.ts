import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();

function mockSessionStorage(): void {
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storage.set(k, v);
    },
    removeItem: (k: string) => {
      storage.delete(k);
    },
    clear: () => storage.clear(),
    key: () => null,
    length: 0
  });
}

describe('Google OAuth fragment token', () => {
  beforeEach(() => {
    storage.clear();
    mockSessionStorage();
    vi.stubGlobal('window', {
      location: { hash: '', pathname: '/', search: '?google_login=1' },
      history: { replaceState: vi.fn() }
    });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('parseGoogleLoginFragmentAccessToken lê JWT após prefixo zapmass_at=', async () => {
    const jwt = 'eyJhbG.eyJzdWI.SIGN';
    const { parseGoogleLoginFragmentAccessToken } = await import('./vpsAuth');
    expect(parseGoogleLoginFragmentAccessToken(`zapmass_at=${encodeURIComponent(jwt)}`)).toBe(jwt);
  });

  it('consumeGoogleLoginFragmentToken guarda token no sessionStorage após limpar hash', async () => {
    const jwt = 'eyJhbG.eyJzdWI.SIGN';
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      location: {
        hash: `#zapmass_at=${encodeURIComponent(jwt)}`,
        pathname: '/',
        search: '?google_login=1'
      },
      history: { replaceState }
    });
    vi.resetModules();
    const { consumeGoogleLoginFragmentToken } = await import('./vpsAuth');
    expect(consumeGoogleLoginFragmentToken()).toBe(jwt);
    expect(replaceState).toHaveBeenCalledWith({}, '', '/?google_login=1');
    expect(consumeGoogleLoginFragmentToken()).toBe(jwt);
  });
});
