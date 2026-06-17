import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { forceAppHardReload, isChunkLoadError } from './chunkLoadRecovery';

/** Import dinâmico com retry via reload forçado (chunks 404 após deploy). */
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
      if (!isChunkLoadError(err)) throw err;
      try {
        const attempts = Number(sessionStorage.getItem(reloadKey) || '0');
        if (attempts < 1) {
          sessionStorage.setItem(reloadKey, String(attempts + 1));
          forceAppHardReload(label);
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
