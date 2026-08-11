import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';

type AppViewContextValue = {
  currentView: string;
  setCurrentView: (view: string) => void;
};

const AppViewContext = createContext<AppViewContextValue | null>(null);

const ALLOWED_VIEWS = new Set([
  'connections',
  'dashboard',
  'chat',
  'warmup',
  'campaigns',
  'contacts',
  'contacts-map',
  'reports',
  'settings',
  'subscription',
  'help',
  'team',
  'admin',
  'creator-studio',
  'admin-ops',
  'religious-members',
  'pastoral-visits',
  'ai-assistant',
  'support-bot'
]);

const LAST_VIEW_KEY = 'zapmass.lastView';

function persistViewInUrl(view: string): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('view', view);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    sessionStorage.setItem(LAST_VIEW_KEY, view);
  } catch {
    /* ignore */
  }
}

function readInitialView(): string {
  if (typeof window === 'undefined') return 'connections';
  try {
    const v = new URLSearchParams(window.location.search).get('view');
    if (v && ALLOWED_VIEWS.has(v)) return v;
  } catch {
    // ignora erros de URL malformada
  }
  try {
    const last = sessionStorage.getItem(LAST_VIEW_KEY);
    if (last && ALLOWED_VIEWS.has(last)) return last;
  } catch {
    /* ignore */
  }
  // Painel: visão padrão (cartão "plano + RAM" e métricas gerais). Use ?view=connections para abrir em Conexões.
  return 'dashboard';
}

export const AppViewProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentView, setCurrentViewState] = useState<string>(readInitialView);
  const setCurrentView = useCallback((view: string) => {
    setCurrentViewState(view);
    persistViewInUrl(view);
  }, []);
  useEffect(() => {
    persistViewInUrl(currentView);
  }, [currentView]);
  const value = useMemo(() => ({ currentView, setCurrentView }), [currentView, setCurrentView]);
  return <AppViewContext.Provider value={value}>{children}</AppViewContext.Provider>;
};

export const useAppView = (): AppViewContextValue => {
  const ctx = useContext(AppViewContext);
  if (!ctx) {
    throw new Error('useAppView deve ser usado dentro de AppViewProvider');
  }
  return ctx;
};
