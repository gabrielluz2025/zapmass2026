import { describe, expect, it } from 'vitest';
import { resolveCityLabelOffline } from './clientCityResolve';

describe('clientCityResolve', () => {
  it('resolve indaial-sc offline', () => {
    expect(resolveCityLabelOffline('indaial-sc')).toBe('Indaial · SC');
    expect(resolveCityLabelOffline('Indaial - SC')).toBe('Indaial · SC');
  });
});
