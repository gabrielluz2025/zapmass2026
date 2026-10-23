import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EVENT_SUBSCRIPTION_REQUIRED,
  SubscriptionRequiredError,
  isSubscriptionRequiredHttpPayload,
} from './subscriptionRequiredFlow';

vi.mock('./apiBase', () => ({
  apiUrl: (path: string) => `http://test.local${path}`,
}));

const getSessionIdToken = vi.fn(async (_forceRefresh?: boolean) => 'test-token');

vi.mock('./sessionAuth', () => ({
  getSessionIdToken: (...args: unknown[]) => getSessionIdToken(...args),
}));

describe('isSubscriptionRequiredHttpPayload', () => {
  it('reconhece 402 com code SUBSCRIPTION_REQUIRED', () => {
    expect(isSubscriptionRequiredHttpPayload(402, { code: 'SUBSCRIPTION_REQUIRED', error: 'Sem plano' })).toBe(true);
    expect(isSubscriptionRequiredHttpPayload(403, { code: 'SUBSCRIPTION_REQUIRED' })).toBe(false);
    expect(isSubscriptionRequiredHttpPayload(402, { code: 'OTHER' })).toBe(false);
  });
});

describe('apiFetchJson subscription guard', () => {
  const listeners: Array<(ev: Event) => void> = [];

  beforeEach(() => {
    listeners.length = 0;
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('window', {
      dispatchEvent: (ev: Event) => {
        for (const fn of listeners) fn(ev);
        return true;
      },
      addEventListener: (_: string, fn: (ev: Event) => void) => {
        listeners.push(fn);
      },
      removeEventListener: (_: string, fn: (ev: Event) => void) => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
    });
  });

  afterEach(() => {
    getSessionIdToken.mockReset();
    getSessionIdToken.mockResolvedValue('test-token');
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('emite evento e lança SubscriptionRequiredError em 402', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          code: 'SUBSCRIPTION_REQUIRED',
          error: 'Assine o Pro.',
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const events: CustomEvent[] = [];
    window.addEventListener(EVENT_SUBSCRIPTION_REQUIRED, (ev) => {
      events.push(ev as CustomEvent);
    });

    const { apiFetchJson } = await import('./apiFetchAuth');
    await expect(apiFetchJson('/api/campaigns/x/redispatch', { method: 'POST' })).rejects.toBeInstanceOf(
      SubscriptionRequiredError
    );
    expect(events).toHaveLength(1);
    expect(events[0].detail).toEqual({ message: 'Assine o Pro.' });
  });

  it('401 em paralelo renova sessão uma vez e reutiliza o token em cache', async () => {
    let accessToken = 'expired-a';
    let forceRefreshCalls = 0;

    getSessionIdToken.mockImplementation(async (forceRefresh?: boolean) => {
      if (forceRefresh) {
        forceRefreshCalls += 1;
        accessToken = 'fresh-b';
        return accessToken;
      }
      return accessToken;
    });

    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const auth = String((init as RequestInit)?.headers && (init as RequestInit).headers);
      const bearer =
        init && typeof init.headers === 'object' && init.headers !== null && !Array.isArray(init.headers)
          ? String((init.headers as Record<string, string>).Authorization || '')
          : auth;
      if (bearer.includes('expired-a')) {
        return new Response(JSON.stringify({ ok: false, error: 'Token expirado' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, users: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const { apiFetchJson } = await import('./apiFetchAuth');
    const [a, b] = await Promise.all([
      apiFetchJson('/api/admin/access-users'),
      apiFetchJson('/api/admin/access-audit'),
    ]);
    expect(a).toEqual({ ok: true, users: [] });
    expect(b).toEqual({ ok: true, users: [] });
    expect(forceRefreshCalls).toBe(1);
  });
});
