import { describe, expect, it } from 'vitest';
import { buildAdminAccessUpdates } from './adminAccessUsers.js';

describe('buildAdminAccessUpdates', () => {
  it('conceder acesso sem canais no payload grava 5 canais do plano', () => {
    const u = buildAdminAccessUpdates(
      { manualGrant: true, grantDays: 30 },
      {},
      'admin@zap-mass.com',
      true
    );
    expect(u.manualGrant).toBe(true);
    expect(u.status).toBe('active');
    expect(u.includedChannels).toBe(5);
    expect(u.trialEndsAt).toBeNull();
    expect(typeof u.manualAccessEndsAt).toBe('string');
  });

  it('sobe de 1 canal do trial para 5 e encerra o relógio do teste', () => {
    const u = buildAdminAccessUpdates(
      { manualGrant: true, grantDays: 365 },
      { status: 'trialing', includedChannels: 1, trialEndsAt: '2026-08-11T18:57:00.000Z' },
      'admin@zap-mass.com',
      true
    );
    expect(u.includedChannels).toBe(5);
    expect(u.trialEndsAt).toBeNull();
    expect(u.status).toBe('active');
  });

  it('definir canais do plano também libera acesso se ainda não houver', () => {
    const u = buildAdminAccessUpdates(
      { includedChannels: 5 },
      { status: 'none', manualGrant: false },
      'admin@zap-mass.com',
      true
    );
    expect(u.manualGrant).toBe(true);
    expect(u.includedChannels).toBe(5);
    expect(u.status).toBe('active');
  });

  it('não apaga prazo manual ao só ajustar extras de quem já tem grant', () => {
    const u = buildAdminAccessUpdates(
      { manualExtraChannelSlots: 2, channelGrantDays: 30 },
      {
        manualGrant: true,
        includedChannels: 2,
        manualAccessEndsAt: '2027-01-01T00:00:00.000Z',
        status: 'active'
      },
      'admin@zap-mass.com',
      true
    );
    expect(u.manualGrant).toBeUndefined();
    expect(u.manualAccessEndsAt).toBeUndefined();
    expect(u.manualExtraChannelSlots).toBe(2);
  });

  it('revogar acesso não recoloca 5 canais', () => {
    const u = buildAdminAccessUpdates(
      { manualGrant: false },
      { manualGrant: true, includedChannels: 5, status: 'active' },
      'admin@zap-mass.com',
      true
    );
    expect(u.manualGrant).toBe(false);
    expect(u.includedChannels).toBeUndefined();
  });

  it('define bônus permanente de canais acima do teto de 5', () => {
    const u = buildAdminAccessUpdates(
      { adminBonusChannelSlots: 15 },
      { status: 'active', includedChannels: 5 },
      'admin@zap-mass.com',
      true
    );
    expect(u.adminBonusChannelSlots).toBe(15);
  });

  it('revoga bônus de canais com zero', () => {
    const u = buildAdminAccessUpdates(
      { adminBonusChannelSlots: 0 },
      { status: 'active', adminBonusChannelSlots: 10 },
      'admin@zap-mass.com',
      true
    );
    expect(u.adminBonusChannelSlots).toBe(0);
  });
});
