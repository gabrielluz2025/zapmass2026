import type { Firestore } from 'firebase-admin/firestore';

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

let cache: { at: number; data: AppConfigGlobal } | null = null;
const TTL_MS = 15_000;

function clampTrialHours(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 168) return 168;
  return Math.round(n);
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
    landingTrialTitle: typeof o.landingTrialTitle === 'string' ? o.landingTrialTitle : '',
    landingTrialBody: typeof o.landingTrialBody === 'string' ? o.landingTrialBody : ''
  };
}

export function defaultAppConfig(): AppConfigGlobal {
  return mergeAppConfigPartial({});
}

export function invalidateAppConfigCache(): void {
  cache = null;
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
      partial.landingTrialTitle !== undefined ? partial.landingTrialTitle : current.landingTrialTitle,
    landingTrialBody: partial.landingTrialBody !== undefined ? partial.landingTrialBody : current.landingTrialBody
  };
  await ref.set(next, { merge: true });
  invalidateAppConfigCache();
  return next;
}

export async function getTrialDurationMs(db: Firestore): Promise<number> {
  const cfg = await loadAppConfig(db);
  return cfg.trialHours * 60 * 60 * 1000;
}
