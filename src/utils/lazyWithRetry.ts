import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/** Import dinâmico com retry único via reload (chunks 404 após deploy). */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
  label = 'view'
): LazyExoticComponent<T> {
  return lazy(async () => {
    const reloadKey = `zapmass.lazyReload.${label}`;
    try {
      const mod = await factory();
      try {
        sessionStorage.removeItem(reloadKey);
      } catch {
        /* ignore */
      }
      return mod;
    } catch (err) {
      try {
        if (!sessionStorage.getItem(reloadKey)) {
          sessionStorage.setItem(reloadKey, '1');
          window.location.reload();
          return new Promise<{ default: T }>(() => {}) as never;
        }
        sessionStorage.removeItem(reloadKey);
      } catch {
        /* ignore */
      }
      throw err;
    }
  });
}
