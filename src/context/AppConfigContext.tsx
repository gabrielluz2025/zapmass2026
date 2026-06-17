import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { clampLandingTrialBody, clampLandingTrialTitle } from '../constants/landingTrialLimits';
import type { AppConfigGlobal, SystemAnnouncement } from '../types/appConfig';
import { DEFAULT_APP_CONFIG } from '../types/appConfig';
import { apiUrl } from '../utils/apiBase';

interface AppConfigContextValue {
  config: AppConfigGlobal;
  loading: boolean;
  reload: () => Promise<void>;
}

const AppConfigContext = createContext<AppConfigContextValue>({
  config: DEFAULT_APP_CONFIG,
  loading: true,
  reload: async () => {}
});

function parseAnnouncement(raw: unknown): SystemAnnouncement | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.active !== true) return null;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  const body = typeof o.body === 'string' ? o.body.trim() : '';
  if (!title || !body) return null;
  const kind =
    o.kind === 'info' || o.kind === 'warning' || o.kind === 'error' ? o.kind : 'info';
  const expiresAt =
    typeof o.expiresAt === 'string' && o.expiresAt.trim() ? o.expiresAt.trim() : null;
  if (expiresAt) {
    const t = Date.parse(expiresAt);
    if (Number.isFinite(t) && t <= Date.now()) return null;
  }
  return {
    active: true,
    title,
    body,
    kind,
    showBanner: o.showBanner !== false,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString(),
    expiresAt,
    publishedBy: typeof o.publishedBy === 'string' ? o.publishedBy : undefined
  };
}

function normalizePayload(raw: unknown): AppConfigGlobal {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const trialRaw = o.trialHours;
  let trialHours = 1;
  if (typeof trialRaw === 'number' && Number.isFinite(trialRaw)) trialHours = Math.round(trialRaw);
  else if (typeof trialRaw === 'string' && trialRaw.trim()) {
    const n = Number(trialRaw);
    if (Number.isFinite(n)) trialHours = Math.round(n);
  }
  trialHours = Math.max(1, Math.min(168, trialHours || 1));
  return {
    marketingPriceMonthly: typeof o.marketingPriceMonthly === 'string' ? o.marketingPriceMonthly : '',
    marketingPriceAnnual: typeof o.marketingPriceAnnual === 'string' ? o.marketingPriceAnnual : '',
    trialHours,
    landingTrialTitle: clampLandingTrialTitle(typeof o.landingTrialTitle === 'string' ? o.landingTrialTitle : ''),
    landingTrialBody: clampLandingTrialBody(typeof o.landingTrialBody === 'string' ? o.landingTrialBody : ''),
    systemAnnouncement: parseAnnouncement(o.systemAnnouncement)
  };
}

export const AppConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<AppConfigGlobal>(DEFAULT_APP_CONFIG);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const ctrl = new AbortController();
    const tid = window.setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await fetch(apiUrl('/api/app-config'), { signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (data?.ok && data?.config) {
        setConfig(normalizePayload(data.config));
      } else {
        setConfig(DEFAULT_APP_CONFIG);
      }
    } catch {
      setConfig(DEFAULT_APP_CONFIG);
    } finally {
      window.clearTimeout(tid);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo(() => ({ config, loading, reload }), [config, loading, reload]);

  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
};

export const useAppConfig = () => useContext(AppConfigContext);
