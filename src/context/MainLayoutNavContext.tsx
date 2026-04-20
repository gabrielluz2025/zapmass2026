import React, { createContext, useContext, ReactNode } from 'react';

const MainLayoutNavContext = createContext<(view: string) => void>(() => {});

export const MainLayoutNavProvider: React.FC<{ navigateTo: (view: string) => void; children: ReactNode }> = ({
  navigateTo,
  children
}) => <MainLayoutNavContext.Provider value={navigateTo}>{children}</MainLayoutNavContext.Provider>;

export const useMainLayoutNav = () => useContext(MainLayoutNavContext);
