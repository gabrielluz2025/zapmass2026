import { afterEach, describe, expect, it } from 'vitest';
import { subscriptionEnforceFromEnv, userHasFullAppAccess } from './subscriptionAccess.js';

const prev = { ...process.env };

afterEach(() => {
  process.env = { ...prev };
});

describe('userHasFullAppAccess', () => {
  const now = Date.now();

  it('denies null or blocked', () => {
    expect(userHasFullAppAccess(null, now)).toBe(false);
    expect(userHasFullAppAccess({ blocked: true, status: 'active' } as any, now)).toBe(false);
  });

  it('allows manual grant without end', () => {
    expect(userHasFullAppAccess({ manualGrant: true, status: 'active' } as any, now)).toBe(true);
  });

  it('allows active with future accessEndsAt', () => {
    expect(
      userHasFullAppAccess(
        { status: 'active', accessEndsAt: new Date(now + 60_000) } as any,
        now
      )
    ).toBe(true);
  });

  it('allows trialing before trialEndsAt', () => {
    expect(
      userHasFullAppAccess(
        { status: 'trialing', trialEndsAt: new Date(now + 60_000) } as any,
        now
      )
    ).toBe(true);
  });
});

describe('subscriptionEnforceFromEnv', () => {
  it('respects SUBSCRIPTION_ENFORCE=0', () => {
    process.env.SUBSCRIPTION_ENFORCE = '0';
    expect(subscriptionEnforceFromEnv()).toBe(false);
  });

  it('respects SUBSCRIPTION_ENFORCE=1 even outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.SUBSCRIPTION_ENFORCE = '1';
    expect(subscriptionEnforceFromEnv()).toBe(true);
  });
});
