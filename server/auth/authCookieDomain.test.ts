import { afterEach, describe, expect, it } from 'vitest';
import {
  vpsAuthCookieBaseFlags,
  vpsAuthCookieDomainSuffix,
  vpsAuthCookieSameSite
} from './authCookieDomain.js';

const keys = ['NODE_ENV', 'PUBLIC_APP_URL', 'GOOGLE_OAUTH_REDIRECT_URI', 'ALLOWED_ORIGINS'] as const;

describe('authCookieDomain', () => {
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  function saveEnv(): void {
    for (const k of keys) prev[k] = process.env[k];
  }

  it('em produção deriva Domain=.zap-mass.com a partir de PUBLIC_APP_URL app', () => {
    saveEnv();
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_APP_URL = 'https://app.zap-mass.com';
    expect(vpsAuthCookieDomainSuffix()).toBe('; Domain=.zap-mass.com');
    expect(vpsAuthCookieSameSite()).toBe('None');
    expect(vpsAuthCookieBaseFlags()).toContain('SameSite=None');
    expect(vpsAuthCookieBaseFlags()).toContain('Domain=.zap-mass.com');
    expect(vpsAuthCookieBaseFlags()).toContain('Secure');
  });

  it('em dev não usa Domain nem SameSite=None', () => {
    saveEnv();
    process.env.NODE_ENV = 'development';
    process.env.PUBLIC_APP_URL = 'https://app.zap-mass.com';
    expect(vpsAuthCookieDomainSuffix()).toBe('');
    expect(vpsAuthCookieSameSite()).toBe('Lax');
    expect(vpsAuthCookieBaseFlags()).not.toContain('Domain=');
    expect(vpsAuthCookieBaseFlags()).toContain('SameSite=Lax');
  });
});
