import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { getSurveyLinksBaseOrigin } from './publicSurveyAppOrigin.js';

const keys = ['PUBLIC_APP_URL', 'APP_PUBLIC_URL', 'ALLOWED_ORIGINS'] as const;

describe('getSurveyLinksBaseOrigin', () => {
  const backup: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) {
      backup[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      const v = backup[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('usa PUBLIC_APP_URL (sem barra final)', () => {
    process.env.PUBLIC_APP_URL = 'https://a.com/';
    process.env.ALLOWED_ORIGINS = 'https://ignored.com';
    expect(getSurveyLinksBaseOrigin()).toBe('https://a.com');
  });

  it('cai para primeiro https em ALLOWED_ORIGINS', () => {
    process.env.ALLOWED_ORIGINS = 'http://127.0.0.1:3001,https://zapmass25.web.app';
    expect(getSurveyLinksBaseOrigin()).toBe('https://zapmass25.web.app');
  });

  it('sem https, usa primeiro URL da lista', () => {
    process.env.ALLOWED_ORIGINS = 'http://10.0.0.1:3001';
    expect(getSurveyLinksBaseOrigin()).toBe('http://10.0.0.1:3001');
  });
});
