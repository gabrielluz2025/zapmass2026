import React, { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

type AppViewContextValue = {
  currentView: string;
  setCurrentView: (view: string) => void;
};

const AppViewContext = createContext<AppViewContextValue | null>(null);

export const AppViewProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentView, setCurrentView] = useState('connections');
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
