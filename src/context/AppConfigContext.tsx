import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import type { AppConfigGlobal } from '../types/appConfig';
import { DEFAULT_APP_CONFIG } from '../types/appConfig';

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
    landingTrialTitle: typeof o.landingTrialTitle === 'string' ? o.landingTrialTitle : '',
    landingTrialBody: typeof o.landingTrialBody === 'string' ? o.landingTrialBody : ''
  };
}

export const AppConfigProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<AppConfigGlobal>(DEFAULT_APP_CONFIG);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/app-config');
      const data = await res.json().catch(() => ({}));
      if (data?.ok && data?.config) {
        setConfig(normalizePayload(data.config));
      } else {
        setConfig(DEFAULT_APP_CONFIG);
      }
    } catch {
      setConfig(DEFAULT_APP_CONFIG);
    } finally {
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
