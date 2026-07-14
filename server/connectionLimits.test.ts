import { describe, expect, it } from 'vitest';
import { getMaxConnectionSlots, MAX_CONNECTIONS_TOTAL } from './connectionLimits.js';

describe('getMaxConnectionSlots', () => {
  it('admin da plataforma usa teto máximo do produto', () => {
    expect(getMaxConnectionSlots({ status: 'none', provider: 'none', plan: null }, { serverAdmin: true })).toBe(
      MAX_CONNECTIONS_TOTAL
    );
  });

  it('cliente com includedChannels=2 sem extras fica em 2', () => {
    expect(
      getMaxConnectionSlots(
        {
          status: 'active',
          provider: 'none',
          plan: null,
          manualGrant: true,
          includedChannels: 2
        },
        { serverAdmin: false }
      )
    ).toBe(2);
  });

  it('includedChannels=2 + 3 extras manuais = 5', () => {
    expect(
      getMaxConnectionSlots(
        {
          status: 'active',
          provider: 'none',
          plan: null,
          manualGrant: true,
          includedChannels: 2,
          manualExtraChannelSlots: 3
        },
        { serverAdmin: false }
      )
    ).toBe(5);
  });
});
