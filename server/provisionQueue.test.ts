import { describe, expect, it } from 'vitest';
import { channelsToInfraTier, suggestSlugFromIdentity } from './provisionQueue.js';

describe('provisionQueue', () => {
  it('channelsToInfraTier', () => {
    expect(channelsToInfraTier(1)).toBe('starter');
    expect(channelsToInfraTier(2)).toBe('starter');
    expect(channelsToInfraTier(3)).toBe('pro');
    expect(channelsToInfraTier(4)).toBe('pro');
    expect(channelsToInfraTier(5)).toBe('business');
  });

  it('suggestSlugFromIdentity evita slug reservado demo', () => {
    expect(suggestSlugFromIdentity('demo@acme.com', '')).toBe('demo-cli');
    expect(suggestSlugFromIdentity('joao@empresa.com', 'João Silva')).toMatch(/joao|silva/i);
  });
});
