import React, { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

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
  'reports',
  'settings',
  'subscription',
  'help',
  'admin',
  'creator-studio',
  'admin-ops'
]);

function readInitialView(): string {
  if (typeof window === 'undefined') return 'connections';
  try {
    const v = new URLSearchParams(window.location.search).get('view');
    if (v && ALLOWED_VIEWS.has(v)) return v;
  } catch {
    // ignora erros de URL malformada
  }
  // Painel: visão padrão (cartão "plano + RAM" e métricas gerais). Use ?view=connections para abrir em Conexões.
  return 'dashboard';
}

export const AppViewProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentView, setCurrentView] = useState<string>(readInitialView);
  const value = useMemo(() => ({ currentView, setCurrentView }), [currentView]);
  return <AppViewContext.Provider value={value}>{children}</AppViewContext.Provider>;
};

export const useAppView = (): AppViewContextValue => {
  const ctx = useContext(AppViewContext);
  if (!ctx) {
    throw new Error('useAppView deve ser usado dentro de AppViewProvider');
  }
  return ctx;
};
