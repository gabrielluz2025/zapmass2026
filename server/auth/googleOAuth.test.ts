import { describe, expect, it } from 'vitest';
import {
  alignOAuthReturnToHost,
  buildGoogleAuthorizationUrl,
  generatePkcePair,
  isGoogleLoginEnabled,
  isInvalidGoogleOAuthClientSecret,
  parseGoogleIdTokenPayload,
  readGoogleOAuthEnv
} from './googleOAuth.js';

describe('googleOAuth', () => {
  it('buildGoogleAuthorizationUrl inclui PKCE e redirect', () => {
    const url = buildGoogleAuthorizationUrl({
      clientId: 'client-id.apps.googleusercontent.com',
      redirectUri: 'https://zap-mass.com/api/auth/google/callback',
      state: 'state-abc',
      codeChallenge: 'challenge-xyz'
    });
    const u = new URL(url);
    expect(u.hostname).toBe('accounts.google.com');
    expect(u.searchParams.get('client_id')).toBe('client-id.apps.googleusercontent.com');
    expect(u.searchParams.get('redirect_uri')).toBe(
      'https://zap-mass.com/api/auth/google/callback'
    );
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBe('challenge-xyz');
    expect(u.searchParams.get('state')).toBe('state-abc');
    expect(u.searchParams.get('response_type')).toBe('code');
  });

  it('alignOAuthReturnToHost alinha www com host do callback OAuth', () => {
    const cb = 'https://zap-mass.com/api/auth/google/callback';
    expect(alignOAuthReturnToHost('https://www.zap-mass.com/?x=1', cb)).toBe(
      'https://zap-mass.com/?x=1'
    );
    expect(alignOAuthReturnToHost('https://zap-mass.com/', cb)).toBe('https://zap-mass.com/');
  });

  it('generatePkcePair produz verifier e challenge distintos', () => {
    const a = generatePkcePair();
    const b = generatePkcePair();
    expect(a.verifier.length).toBeGreaterThan(20);
    expect(a.challenge).not.toBe(a.verifier);
    expect(a.verifier).not.toBe(b.verifier);
  });

  it('parseGoogleIdTokenPayload exige e-mail e sub', () => {
    expect(
      parseGoogleIdTokenPayload({
        sub: 'google-sub-1',
        email: 'a@test.com',
        email_verified: true
      })
    ).toEqual({
      sub: 'google-sub-1',
      email: 'a@test.com',
      emailVerified: true,
      name: undefined,
      picture: undefined
    });

    expect(
      parseGoogleIdTokenPayload({
        sub: 'x',
        email: 'a@test.com',
        email_verified: false
      })
    ).toEqual({
      sub: 'x',
      email: 'a@test.com',
      emailVerified: false,
      name: undefined,
      picture: undefined
    });

    expect(parseGoogleIdTokenPayload({ sub: '', email: 'a@test.com' })).toBeNull();
  });

  it('isInvalidGoogleOAuthClientSecret detecta secret igual ao Client ID', () => {
    const id = '123.apps.googleusercontent.com';
    expect(isInvalidGoogleOAuthClientSecret(id, id)).toBe(true);
    expect(isInvalidGoogleOAuthClientSecret(id, 'GOCSPX-abc')).toBe(false);
    expect(isInvalidGoogleOAuthClientSecret(id, 'wrong.apps.googleusercontent.com')).toBe(true);
  });

  it('readGoogleOAuthEnv rejeita secret inválido', () => {
    const prev = {
      id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect: process.env.GOOGLE_OAUTH_REDIRECT_URI
    };
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'id.apps.googleusercontent.com';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'id.apps.googleusercontent.com';
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://example.com/cb';
    expect(readGoogleOAuthEnv()).toBeNull();

    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'GOCSPX-test';
    expect(readGoogleOAuthEnv()?.clientSecret).toBe('GOCSPX-test');

    if (prev.id === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = prev.id;
    if (prev.secret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    else process.env.GOOGLE_OAUTH_CLIENT_SECRET = prev.secret;
    if (prev.redirect === undefined) delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    else process.env.GOOGLE_OAUTH_REDIRECT_URI = prev.redirect;
  });

  it('isGoogleLoginEnabled depende de ZAPMASS_GOOGLE_LOGIN e credenciais', () => {
    const prev = {
      flag: process.env.ZAPMASS_GOOGLE_LOGIN,
      id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect: process.env.GOOGLE_OAUTH_REDIRECT_URI
    };
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://example.com/cb';

    process.env.ZAPMASS_GOOGLE_LOGIN = '0';
    expect(isGoogleLoginEnabled()).toBe(false);

    process.env.ZAPMASS_GOOGLE_LOGIN = '1';
    expect(isGoogleLoginEnabled()).toBe(true);
    expect(readGoogleOAuthEnv()?.clientId).toBe('id');

    if (prev.flag === undefined) delete process.env.ZAPMASS_GOOGLE_LOGIN;
    else process.env.ZAPMASS_GOOGLE_LOGIN = prev.flag;
    if (prev.id === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = prev.id;
    if (prev.secret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    else process.env.GOOGLE_OAUTH_CLIENT_SECRET = prev.secret;
    if (prev.redirect === undefined) delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    else process.env.GOOGLE_OAUTH_REDIRECT_URI = prev.redirect;
  });
});
