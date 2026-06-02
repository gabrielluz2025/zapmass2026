export type ZapmassAuthProvider = 'firebase' | 'vps' | 'dual';

export function zapmassAuthProvider(): ZapmassAuthProvider {
  const raw = (process.env.ZAPMASS_AUTH_PROVIDER || 'vps').trim().toLowerCase();
  if (raw === 'firebase' || raw === 'dual') return raw;
  return 'vps';
}

export function vpsAuthEnabled(): boolean {
  return zapmassAuthProvider() === 'vps' || zapmassAuthProvider() === 'dual';
}

export function vpsAuthRequired(): boolean {
  return zapmassAuthProvider() === 'vps';
}
