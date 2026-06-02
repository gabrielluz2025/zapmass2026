import { zapmassAuthProvider } from './authMode.js';

export type ZapmassDataProvider = 'firebase' | 'vps' | 'dual';

export function zapmassDataProvider(): ZapmassDataProvider {
  const raw = (process.env.ZAPMASS_DATA_PROVIDER || '').trim().toLowerCase();
  if (raw === 'vps' || raw === 'dual') return raw;
  if (raw === 'firebase') return 'firebase';
  return 'vps';
}

export function vpsDataEnabled(): boolean {
  const d = zapmassDataProvider();
  return d === 'vps' || d === 'dual';
}

export function vpsDataRequired(): boolean {
  return zapmassDataProvider() === 'vps';
}
