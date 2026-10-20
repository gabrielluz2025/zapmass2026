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

vi.mock('../utils/apiBase', () => ({
  apiUrl: (path: string) => `http://test.local${path}`
}));

describe('vpsRefreshAccessToken dedupe', () => {
  beforeEach(() => {
    storage.clear();
    mockSessionStorage();
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    });
    vi.stubGlobal('window', { setTimeout, clearTimeout, addEventListener: vi.fn() });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('dois refresh concorrentes disparam um único POST', async () => {
    let fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        fetchCalls += 1;
        return new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(
                JSON.stringify({
                  accessToken: 'tok',
                  user: { id: 'u1', email: 'a@b.c', role: 'owner' }
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              )
            );
          }, 20);
        });
      })
    );

    const { vpsRefreshAccessToken } = await import('./vpsAuth');
    const [a, b] = await Promise.all([vpsRefreshAccessToken(), vpsRefreshAccessToken()]);
    expect(a).toBe('tok');
    expect(b).toBe('tok');
    expect(fetchCalls).toBe(1);
  });
});
