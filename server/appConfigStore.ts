import type { Firestore } from 'firebase-admin/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';
import { vpsDataEnabled } from './auth/dataMode.js';
import { getZapmassPool } from './db/postgres.js';
import { loadAppConfigPg, saveAppConfigPg } from './repositories/appConfigRepository.js';

/** Espelha `src/types/appConfig.ts` (mantenha campos alinhados). */
export interface AppConfigGlobal {
  marketingPriceMonthly: string;
  marketingPriceAnnual: string;
  trialHours: number;
  landingTrialTitle: string;
  landingTrialBody: string;
}

const COLLECTION = 'appConfig';
const DOC_ID = 'global';

/** Alinhado a `src/constants/landingTrialLimits.ts`. */
const LANDING_TRIAL_TITLE_MAX = 120;
const LANDING_TRIAL_BODY_MAX = 600;

function clampLandingStr(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

let cache: { at: number; data: AppConfigGlobal } | null = null;
const TTL_MS = 15_000;

function clampTrialHours(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 168) return 168;
  return Math.round(n);
}

export function clampLandingTrialTitleInput(s: string): string {
  return clampLandingStr(s, LANDING_TRIAL_TITLE_MAX);
}

export function clampLandingTrialBodyInput(s: string): string {
  return clampLandingStr(s, LANDING_TRIAL_BODY_MAX);
}

export function mergeAppConfigPartial(raw: Record<string, unknown> | undefined): AppConfigGlobal {
  const o = raw || {};
  const th = o.trialHours;
  let trialHours = 1;
  if (typeof th === 'number' && Number.isFinite(th)) trialHours = clampTrialHours(th);
  else if (typeof th === 'string' && th.trim()) {
    const n = Number(th);
    if (Number.isFinite(n)) trialHours = clampTrialHours(n);
  }
  return {
    marketingPriceMonthly: typeof o.marketingPriceMonthly === 'string' ? o.marketingPriceMonthly : '',
    marketingPriceAnnual: typeof o.marketingPriceAnnual === 'string' ? o.marketingPriceAnnual : '',
    trialHours,
    landingTrialTitle: clampLandingStr(
      typeof o.landingTrialTitle === 'string' ? o.landingTrialTitle : '',
      LANDING_TRIAL_TITLE_MAX
    ),
    landingTrialBody: clampLandingStr(
      typeof o.landingTrialBody === 'string' ? o.landingTrialBody : '',
      LANDING_TRIAL_BODY_MAX
    )
  };
}

export function defaultAppConfig(): AppConfigGlobal {
  return mergeAppConfigPartial({});
}

export function invalidateAppConfigCache(): void {
  cache = null;
}

function usePostgresAppConfig(): boolean {
  return vpsDataEnabled() && !!getZapmassPool();
}

export async function loadAppConfigGlobal(): Promise<AppConfigGlobal> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return cache.data;
  }
  let merged: AppConfigGlobal;
  if (usePostgresAppConfig()) {
    const raw = await loadAppConfigPg();
    merged = mergeAppConfigPartial(raw || undefined);
  } else {
    const admin = getFirebaseAdmin();
    if (!admin) {
      merged = defaultAppConfig();
    } else {
      merged = await loadAppConfig(getFirestore(admin));
      cache = { at: now, data: merged };
      return merged;
    }
  }
  cache = { at: now, data: merged };
  return merged;
}

export async function saveAppConfigGlobal(partial: Partial<AppConfigGlobal>): Promise<AppConfigGlobal> {
  const current = await loadAppConfigGlobal();
  const next: AppConfigGlobal = {
    marketingPriceMonthly:
      partial.marketingPriceMonthly !== undefined ? partial.marketingPriceMonthly : current.marketingPriceMonthly,
    marketingPriceAnnual:
      partial.marketingPriceAnnual !== undefined ? partial.marketingPriceAnnual : current.marketingPriceAnnual,
    trialHours: partial.trialHours !== undefined ? clampTrialHours(partial.trialHours) : current.trialHours,
    landingTrialTitle:
      partial.landingTrialTitle !== undefined
        ? clampLandingStr(partial.landingTrialTitle, LANDING_TRIAL_TITLE_MAX)
        : current.landingTrialTitle,
    landingTrialBody:
      partial.landingTrialBody !== undefined
        ? clampLandingStr(partial.landingTrialBody, LANDING_TRIAL_BODY_MAX)
        : current.landingTrialBody
  };
  if (usePostgresAppConfig()) {
    await saveAppConfigPg(next);
  } else {
    const admin = getFirebaseAdmin();
    if (admin) {
      await saveAppConfigMerge(getFirestore(admin), partial);
      return loadAppConfigGlobal();
    }
  }
  invalidateAppConfigCache();
  cache = { at: Date.now(), data: next };
  return next;
}

export async function loadAppConfig(db: Firestore): Promise<AppConfigGlobal> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return cache.data;
  }
  const snap = await db.collection(COLLECTION).doc(DOC_ID).get();
  const merged = snap.exists ? mergeAppConfigPartial(snap.data() as Record<string, unknown>) : defaultAppConfig();
  cache = { at: now, data: merged };
  return merged;
}

export async function saveAppConfigMerge(db: Firestore, partial: Partial<AppConfigGlobal>): Promise<AppConfigGlobal> {
  const ref = db.collection(COLLECTION).doc(DOC_ID);
  const snap = await ref.get();
  const current = snap.exists ? mergeAppConfigPartial(snap.data() as Record<string, unknown>) : defaultAppConfig();
  const next: AppConfigGlobal = {
    marketingPriceMonthly:
      partial.marketingPriceMonthly !== undefined ? partial.marketingPriceMonthly : current.marketingPriceMonthly,
    marketingPriceAnnual:
      partial.marketingPriceAnnual !== undefined ? partial.marketingPriceAnnual : current.marketingPriceAnnual,
    trialHours: partial.trialHours !== undefined ? clampTrialHours(partial.trialHours) : current.trialHours,
    landingTrialTitle:
      partial.landingTrialTitle !== undefined
        ? clampLandingStr(partial.landingTrialTitle, LANDING_TRIAL_TITLE_MAX)
        : current.landingTrialTitle,
    landingTrialBody:
      partial.landingTrialBody !== undefined
        ? clampLandingStr(partial.landingTrialBody, LANDING_TRIAL_BODY_MAX)
        : current.landingTrialBody
  };
  await ref.set(next, { merge: true });
  invalidateAppConfigCache();
  return next;
}

export async function getTrialDurationMs(db?: Firestore): Promise<number> {
  const cfg = db && !usePostgresAppConfig() ? await loadAppConfig(db) : await loadAppConfigGlobal();
  return cfg.trialHours * 60 * 60 * 1000;
}
