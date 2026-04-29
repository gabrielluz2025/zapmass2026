import { describe, expect, it } from 'vitest';
import { parseExternalReference } from './mpExternalReference.js';

describe('parseExternalReference', () => {
  it('returns none for empty', () => {
    expect(parseExternalReference('')).toEqual({ kind: 'none' });
    expect(parseExternalReference(null)).toEqual({ kind: 'none' });
  });

  it('parses legacy monthly/annual', () => {
    expect(parseExternalReference('abc123:monthly')).toEqual({ kind: 'plan', uid: 'abc123', plan: 'monthly' });
    expect(parseExternalReference('u:mensal')).toEqual({ kind: 'plan', uid: 'u', plan: 'monthly' });
    expect(parseExternalReference('u:anual')).toEqual({ kind: 'plan', uid: 'u', plan: 'annual' });
  });

  it('parses tier plan', () => {
    expect(parseExternalReference('u:tier:3:monthly')).toEqual({
      kind: 'tier_plan',
      uid: 'u',
      plan: 'monthly',
      channels: 3
    });
  });

  it('parses chaddon', () => {
    expect(parseExternalReference('u:chaddon_once:2')).toEqual({ kind: 'chaddon_once', uid: 'u', extraSlots: 2 });
    expect(parseExternalReference('u:chaddon_recur:1')).toEqual({ kind: 'chaddon_recur', uid: 'u', extraSlots: 1 });
  });
});
