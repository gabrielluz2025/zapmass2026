const RELOAD_ATTEMPTS_KEY = 'zapmass.chunkReloadAttempts';
const MAX_AUTO_RELOADS = 2;

/** Erro típico quando o chunk lazy mudou de hash após deploy (404 em /assets/*.js). */
export function isChunkLoadError(reason: unknown): boolean {
  const msg =
    reason instanceof Error
      ? `${reason.message} ${reason.name}`
      : typeof reason === 'string'
        ? reason
        : '';
  const normalized = msg.toLowerCase();
  return (
    normalized.includes('failed to fetch dynamically imported module') ||
    normalized.includes('importing a module script failed') ||
    normalized.includes('error loading dynamically imported module') ||
    normalized.includes('chunkloaderror')
  );
}

/** Recarrega a SPA ignorando cache (evita index.html ou bundle antigo após deploy). */
export function forceAppHardReload(scope = 'app'): void {
  try {
    const attempts = Number(sessionStorage.getItem(RELOAD_ATTEMPTS_KEY) || '0');
    if (attempts >= MAX_AUTO_RELOADS) {
      sessionStorage.removeItem(RELOAD_ATTEMPTS_KEY);
      return;
    }
    sessionStorage.setItem(RELOAD_ATTEMPTS_KEY, String(attempts + 1));
  } catch {
    /* ignore */
  }

  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith('zapmass.lazyReload.')) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }

  const url = new URL(window.location.href);
  url.searchParams.set('_chunk', `${scope}-${Date.now()}`);
  window.location.replace(url.toString());
}

/** Limpa contador após boot bem-sucedido (chamar uma vez no entry). */
export function clearChunkReloadAttempts(): void {
  try {
    sessionStorage.removeItem(RELOAD_ATTEMPTS_KEY);
  } catch {
    /* ignore */
  }
}

/** Vite + import() dinâmico: recarrega automaticamente uma vez após deploy. */
export function registerChunkLoadRecovery(): void {
  window.addEventListener('vite:preloadError', (ev) => {
    ev.preventDefault();
    forceAppHardReload('vite-preload');
  });

  window.addEventListener('unhandledrejection', (ev) => {
    if (!isChunkLoadError(ev.reason)) return;
    ev.preventDefault();
    forceAppHardReload('dynamic-import');
  });

  // BFCache do Chrome pode restaurar JS antigo sem buscar index.html novo.
  window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) {
      forceAppHardReload('bfcache');
    }
  });
}
