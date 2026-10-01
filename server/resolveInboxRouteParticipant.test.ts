import { afterEach, describe, expect, it, vi } from 'vitest';

const resolveAuthPrincipal = vi.hoisted(() => vi.fn());
const zapmassAuthProvider = vi.hoisted(() => vi.fn(() => 'vps' as 'vps' | 'firebase' | 'dual'));
const getFirebaseAdmin = vi.hoisted(() => vi.fn(() => null as null | object));

vi.mock('./resolveAuth.js', () => ({
  resolveAuthPrincipal
}));
vi.mock('./auth/authMode.js', () => ({
  zapmassAuthProvider
}));
vi.mock('./firebaseAdmin.js', () => ({
  getFirebaseAdmin
}));

import { resolveInboxRouteParticipant } from './inboxRouteAuth.js';

describe('resolveInboxRouteParticipant', () => {
  afterEach(() => {
    vi.clearAllMocks();
    zapmassAuthProvider.mockReturnValue('vps');
    getFirebaseAdmin.mockReturnValue(null);
  });

  it('devolve tenant/auth quando o JWT VPS é válido', async () => {
    resolveAuthPrincipal.mockResolvedValue({
      provider: 'vps',
      authUid: 'staff-1',
      tenantUid: 'owner-1',
      email: 's@test.com',
      role: 'staff',
      ownerUid: 'owner-1'
    });
    const r = await resolveInboxRouteParticipant('token');
    expect(r).toEqual({
      ok: true,
      tenantUid: 'owner-1',
      authUid: 'staff-1',
      provider: 'vps'
    });
  });

  it('em modo VPS sem token válido responde 401, não 503 Firebase', async () => {
    resolveAuthPrincipal.mockResolvedValue(null);
    zapmassAuthProvider.mockReturnValue('vps');
    const r = await resolveInboxRouteParticipant('bad');
    expect(r).toEqual({ ok: false, status: 401, error: 'Token inválido.' });
  });

  it('em modo firebase sem Admin devolve 503', async () => {
    resolveAuthPrincipal.mockResolvedValue(null);
    zapmassAuthProvider.mockReturnValue('firebase');
    getFirebaseAdmin.mockReturnValue(null);
    const r = await resolveInboxRouteParticipant('bad');
    expect(r).toEqual({
      ok: false,
      status: 503,
      error: 'Firebase Admin não configurado no servidor.'
    });
  });
});
