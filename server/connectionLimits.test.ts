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

  it('liberação manual sem includedChannels usa o teto de 5 canais', () => {
    expect(
      getMaxConnectionSlots(
        {
          status: 'active',
          provider: 'none',
          plan: null,
          manualGrant: true
        },
        { serverAdmin: false }
      )
    ).toBe(MAX_CONNECTIONS_TOTAL);
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

  it('bônus admin soma acima do teto de 5', () => {
    expect(
      getMaxConnectionSlots(
        {
          status: 'active',
          provider: 'none',
          plan: null,
          manualGrant: true,
          includedChannels: 5,
          adminBonusChannelSlots: 10
        },
        { serverAdmin: false }
      )
    ).toBe(15);
  });

  it('plano 2 + bônus admin 8 = 10', () => {
    expect(
      getMaxConnectionSlots(
        {
          status: 'active',
          provider: 'none',
          plan: null,
          manualGrant: true,
          includedChannels: 2,
          adminBonusChannelSlots: 8
        },
        { serverAdmin: false }
      )
    ).toBe(10);
  });
});
