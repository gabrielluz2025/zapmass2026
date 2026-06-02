import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { signAccessToken, verifyAccessToken } from './jwt.js';

describe('jwt', () => {
  const prev = process.env.ZAPMASS_JWT_SECRET;

  beforeEach(() => {
    process.env.ZAPMASS_JWT_SECRET = 'test-secret-min-16-chars!!';
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.ZAPMASS_JWT_SECRET;
    else process.env.ZAPMASS_JWT_SECRET = prev;
  });

  it('assina e valida access token', async () => {
    const token = await signAccessToken({
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'a@test.com',
      role: 'owner',
      tenantUid: '11111111-1111-1111-1111-111111111111'
    });
    const claims = await verifyAccessToken(token);
    expect(claims?.sub).toBe('11111111-1111-1111-1111-111111111111');
    expect(claims?.role).toBe('owner');
  });
});
