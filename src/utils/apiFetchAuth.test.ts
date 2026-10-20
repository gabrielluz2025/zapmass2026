import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EVENT_SUBSCRIPTION_REQUIRED,
  SubscriptionRequiredError,
  isSubscriptionRequiredHttpPayload,
} from './subscriptionRequiredFlow';

vi.mock('./apiBase', () => ({
  apiUrl: (path: string) => `http://test.local${path}`,
}));

vi.mock('./sessionAuth', () => ({
  getSessionIdToken: vi.fn(async () => 'test-token'),
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
});
