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

describe('vpsAuth logout', () => {
  beforeEach(() => {
    storage.clear();
    mockSessionStorage();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('limpa sessionStorage antes de concluir POST /logout', async () => {
    storage.set('zapmass_access_token', 'tok');
    storage.set('zapmass_auth_user', '{"id":"u1","email":"a@b.c","role":"owner"}');

    let resolveFetch!: () => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = () => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    vi.mocked(fetch).mockReturnValue(fetchPromise);

    const { vpsLogout, getVpsAccessToken } = await import('./vpsAuth');
    const pending = vpsLogout();
    expect(getVpsAccessToken()).toBeNull();
    resolveFetch();
    await pending;
    expect(getVpsAccessToken()).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      'http://test.local/api/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    );
  });

  it('refresh em voo não repõe token após flag de logout', async () => {
    storage.set('zapmass_logout_flag', String(Date.now()));

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ accessToken: 'new-tok', user: { id: 'u1', email: 'a@b.c', role: 'owner' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const { vpsRefreshAccessToken, getVpsAccessToken } = await import('./vpsAuth');
    const token = await vpsRefreshAccessToken();
    expect(token).toBeNull();
    expect(getVpsAccessToken()).toBeNull();
  });
});
