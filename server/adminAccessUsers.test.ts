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
    expect(typeof u.manualAccessEndsAt).toBe('string');
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
});
