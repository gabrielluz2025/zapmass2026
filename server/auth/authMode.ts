export type ZapmassAuthProvider = 'firebase' | 'vps' | 'dual';

export function zapmassAuthProvider(): ZapmassAuthProvider {
  const raw = (process.env.ZAPMASS_AUTH_PROVIDER || 'firebase').trim().toLowerCase();
  if (raw === 'vps' || raw === 'dual') return raw;
  return 'firebase';
}

export function vpsAuthEnabled(): boolean {
  return zapmassAuthProvider() === 'vps' || zapmassAuthProvider() === 'dual';
}

export function vpsAuthRequired(): boolean {
  return zapmassAuthProvider() === 'vps';
}
