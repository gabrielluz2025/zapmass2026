import { getFirebaseAdmin } from './firebaseAdmin.js';
import { getFirestore } from 'firebase-admin/firestore';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { loadDispatchSettingsPg, saveDispatchSettingsPg } from './repositories/tenantSettingsRepository.js';

export type OperatingLocationSource = 'manual' | 'gps';

export interface OperatingLocation {
  cityLabel: string;
  latitude?: number;
  longitude?: number;
  source?: OperatingLocationSource;
  updatedAt?: string;
}

export const DEFAULT_OPERATING_CITY_LABEL = 'Blumenau · SC';

const cache = new Map<string, OperatingLocation>();

function usePostgres(): boolean {
  return vpsDataEnabled() && !!getZapmassPool();
}

function docRef(uid: string) {
  const admin = getFirebaseAdmin();
  if (!admin) return null;
  const db = getFirestore(admin);
  return db.collection('users').doc(uid).collection('settings').doc('dispatch');
}

function titleCaseCity(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .map((w) => w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1))
    .join(' ');
}

function normalizeUf(raw: string): string {
  const st = String(raw || '').trim().toUpperCase().slice(0, 2);
  return /^[A-Z]{2}$/.test(st) ? st : '';
}

/** Normaliza "blumenau - sc" → "Blumenau · SC". */
export function normalizeCityLabel(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return DEFAULT_OPERATING_CITY_LABEL;

  const dot = trimmed.match(/^(.+?)\s*·\s*([A-Za-z]{2})\s*$/);
  if (dot) {
    const city = titleCaseCity(dot[1]);
    const uf = normalizeUf(dot[2]);
    return uf ? `${city} · ${uf}` : city || DEFAULT_OPERATING_CITY_LABEL;
  }

  const dash = trimmed.match(/^(.+?)\s*[-–/,]\s*([A-Za-z]{2})\s*$/);
  if (dash) {
    const city = titleCaseCity(dash[1]);
    const uf = normalizeUf(dash[2]);
    return uf ? `${city} · ${uf}` : city || DEFAULT_OPERATING_CITY_LABEL;
  }

  return titleCaseCity(trimmed) || DEFAULT_OPERATING_CITY_LABEL;
}

function extractFromDoc(raw: Record<string, unknown> | null | undefined): OperatingLocation {
  if (!raw) {
    return { cityLabel: DEFAULT_OPERATING_CITY_LABEL };
  }
  const cityLabel = normalizeCityLabel(
    typeof raw.operatingCityLabel === 'string'
      ? raw.operatingCityLabel
      : typeof raw.operatingCity === 'string'
        ? raw.operatingCity
        : DEFAULT_OPERATING_CITY_LABEL
  );
  const lat = Number(raw.operatingLat ?? raw.operatingLatitude);
  const lng = Number(raw.operatingLng ?? raw.operatingLongitude);
  const source =
    raw.operatingSource === 'gps' || raw.operatingSource === 'manual'
      ? raw.operatingSource
      : undefined;
  const updatedAt = typeof raw.operatingUpdatedAt === 'string' ? raw.operatingUpdatedAt : undefined;
  return {
    cityLabel,
    ...(Number.isFinite(lat) ? { latitude: lat } : {}),
    ...(Number.isFinite(lng) ? { longitude: lng } : {}),
    ...(source ? { source } : {}),
    ...(updatedAt ? { updatedAt } : {})
  };
}

function mergeIntoDoc(
  base: Record<string, unknown> | null | undefined,
  loc: OperatingLocation
): Record<string, unknown> {
  const doc = { ...(base || {}) };
  doc.operatingCityLabel = loc.cityLabel;
  doc.operatingSource = loc.source || 'manual';
  doc.operatingUpdatedAt = loc.updatedAt || new Date().toISOString();
  if (loc.latitude !== undefined && Number.isFinite(loc.latitude)) {
    doc.operatingLat = loc.latitude;
  } else {
    delete doc.operatingLat;
  }
  if (loc.longitude !== undefined && Number.isFinite(loc.longitude)) {
    doc.operatingLng = loc.longitude;
  } else {
    delete doc.operatingLng;
  }
  return doc;
}

export async function loadOperatingLocation(tenantId: string): Promise<OperatingLocation> {
  if (!tenantId || tenantId === 'anonymous') {
    return { cityLabel: DEFAULT_OPERATING_CITY_LABEL };
  }
  const cached = cache.get(tenantId);
  if (cached) return { ...cached };

  if (usePostgres()) {
    try {
      const raw = await loadDispatchSettingsPg(tenantId);
      const loc = extractFromDoc(raw || undefined);
      cache.set(tenantId, loc);
      return { ...loc };
    } catch (e: unknown) {
      console.warn('[operatingLocation/PG] Falha ao carregar:', (e as Error)?.message || e);
    }
  }

  const ref = docRef(tenantId);
  if (ref) {
    try {
      const snap = await ref.get();
      const loc = extractFromDoc(snap.exists ? (snap.data() as Record<string, unknown>) : undefined);
      cache.set(tenantId, loc);
      return { ...loc };
    } catch (e: unknown) {
      console.warn('[operatingLocation] Falha ao carregar:', (e as Error)?.message || e);
    }
  }

  const fallback = { cityLabel: DEFAULT_OPERATING_CITY_LABEL };
  cache.set(tenantId, fallback);
  return fallback;
}

export async function saveOperatingLocation(
  tenantId: string,
  partial: Partial<OperatingLocation>
): Promise<OperatingLocation> {
  if (!tenantId || tenantId === 'anonymous') {
    throw new Error('Conta inválida para salvar localização.');
  }
  const current = await loadOperatingLocation(tenantId);
  const next: OperatingLocation = {
    ...current,
    ...partial,
    cityLabel: normalizeCityLabel(partial.cityLabel ?? current.cityLabel),
    updatedAt: new Date().toISOString()
  };
  if (partial.source) next.source = partial.source;
  cache.set(tenantId, next);

  if (usePostgres()) {
    const existing = (await loadDispatchSettingsPg(tenantId)) || {};
    await saveDispatchSettingsPg(tenantId, mergeIntoDoc(existing, next));
    return { ...next };
  }

  const ref = docRef(tenantId);
  if (ref) {
    const patch = mergeIntoDoc(undefined, next);
    await ref.set(patch, { merge: true });
    return { ...next };
  }

  return { ...next };
}
