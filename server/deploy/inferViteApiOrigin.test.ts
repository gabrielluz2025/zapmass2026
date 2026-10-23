import { describe, expect, it } from 'vitest';
import { inferViteApiOriginIfNeeded } from './inferViteApiOrigin.js';

describe('inferViteApiOriginIfNeeded', () => {
  it('não infere quando ZAPMASS_CROSS_HOST_API está ausente', () => {
    expect(
      inferViteApiOriginIfNeeded({
        PUBLIC_APP_URL: 'https://app.zap-mass.com',
        GOOGLE_OAUTH_REDIRECT_URI: 'https://zap-mass.com/api/auth/google/callback'
      })
    ).toBeUndefined();
  });

  it('infere apex só com ZAPMASS_CROSS_HOST_API=1', () => {
    expect(
      inferViteApiOriginIfNeeded({
        ZAPMASS_CROSS_HOST_API: '1',
        PUBLIC_APP_URL: 'https://app.zap-mass.com',
        GOOGLE_OAUTH_REDIRECT_URI: 'https://zap-mass.com/api/auth/google/callback'
      })
    ).toBe('https://zap-mass.com');
  });

  it('não infere quando painel e callback no mesmo host', () => {
    expect(
      inferViteApiOriginIfNeeded({
        ZAPMASS_CROSS_HOST_API: '1',
        PUBLIC_APP_URL: 'https://app.zap-mass.com',
        GOOGLE_OAUTH_REDIRECT_URI: 'https://app.zap-mass.com/api/auth/google/callback'
      })
    ).toBeUndefined();
  });

  it('respeita VITE_API_ORIGIN já definido', () => {
    expect(
      inferViteApiOriginIfNeeded({
        VITE_API_ORIGIN: 'https://api.example.com',
        ZAPMASS_CROSS_HOST_API: '1',
        PUBLIC_APP_URL: 'https://app.example.com',
        GOOGLE_OAUTH_REDIRECT_URI: 'https://example.com/cb'
      })
    ).toBe('https://api.example.com');
  });
});
