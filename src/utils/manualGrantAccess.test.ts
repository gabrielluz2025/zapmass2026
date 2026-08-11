import { describe, expect, it } from 'vitest';
import { isManualGrantAccessActive } from './manualGrantAccess';

describe('isManualGrantAccessActive', () => {
  it('é verdadeiro com grant sem data de fim', () => {
    expect(isManualGrantAccessActive({ manualGrant: true })).toBe(true);
  });

  it('é verdadeiro com prazo no futuro', () => {
    expect(
      isManualGrantAccessActive({
        manualGrant: true,
        manualAccessEndsAt: '2027-08-11T15:20:01.000Z'
      })
    ).toBe(true);
  });

  it('é falso se o trial existir mas não houver grant', () => {
    expect(
      isManualGrantAccessActive({
        manualGrant: false,
        manualAccessEndsAt: '2027-08-11T15:20:01.000Z'
      })
    ).toBe(false);
  });
});
