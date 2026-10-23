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

describe('vpsEstablishSessionAfterGoogleOAuth', () => {
  beforeEach(() => {
    storage.clear();
    mockSessionStorage();
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      location: { hostname: 'localhost', pathname: '/', search: '', hash: '' }
    });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('prioriza bootstrap via fragment quando refresh demora', async () => {
    const jwt = 'eyJhbG.eyJzdWI.SIGN';
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/auth/refresh')) {
        await new Promise((r) => setTimeout(r, 50));
        return new Response(JSON.stringify({ accessToken: 'from-cookie', user: { id: '1', email: 'a@b.c', role: 'owner' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify({ user: { id: '1', email: 'a@b.c', role: 'owner' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { vpsEstablishSessionAfterGoogleOAuth } = await import('./vpsAuth');
    const token = await vpsEstablishSessionAfterGoogleOAuth(jwt);
    expect(token).toBe(jwt);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/auth/me'))).toBe(true);
  });

  it('usa refresh quando não há fragment', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/auth/refresh')) {
        return new Response(
          JSON.stringify({ accessToken: 'only-refresh', user: { id: '2', email: 'x@y.z', role: 'owner' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { vpsEstablishSessionAfterGoogleOAuth } = await import('./vpsAuth');
    const token = await vpsEstablishSessionAfterGoogleOAuth(null);
    expect(token).toBe('only-refresh');
  });
});
