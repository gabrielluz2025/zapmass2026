const trimSlash = (s: string) => s.replace(/\/+$/, '');

function readRuntimeWindowApiOrigin(): string {
  if (typeof window === 'undefined') return '';
  const raw = (window as Window & { __ZAPMASS_API_ORIGIN__?: unknown }).__ZAPMASS_API_ORIGIN__;
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return '';
  return trimSlash(s);
}

/** Fallback sem rebuild: em `index.html` use `<meta name="zapmass-api-origin" content="https://api...">` */
function readMetaApiOrigin(): string {
  if (typeof document === 'undefined') return '';
  const el = document.querySelector('meta[name="zapmass-api-origin"]');
  const raw = el?.getAttribute('content')?.trim();
  if (!raw) return '';
  return trimSlash(raw);
}

/**
 * Origem absoluta do backend (REST + Socket.IO), sem barra final.
 * Para hosting estático separado (ex.: Firebase) defina no build:
 * `VITE_API_ORIGIN=https://api.seudominio.com`
 * Ou meta `zapmass-api-origin` / `window.__ZAPMASS_API_ORIGIN__` (emergência sem rebuild completo).
 * Inclua o domínio do site em `ALLOWED_ORIGINS` no servidor (CORS).
 */
export function getApiOrigin(): string {
  const fromEnv = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.trim();
  if (fromEnv) return trimSlash(fromEnv);
  const fromWindow = readRuntimeWindowApiOrigin();
  if (fromWindow) return fromWindow;
  const fromMeta = readMetaApiOrigin();
  if (fromMeta) return fromMeta;
  return '';
}

/**
 * Firebase Hosting / domínios só estáticos: sem `VITE_API_ORIGIN` o cliente não pode usar
 * «mesma origem» — não há Node nem WebSocket na hospedagem estática.
 */
export function isLikelySplitStaticFrontend(): boolean {
  if (typeof window === 'undefined') return false;
  if (getApiOrigin()) return false;
  const h = window.location.hostname.toLowerCase();
  return h.endsWith('.web.app') || h.endsWith('.firebaseapp.com');
}

/** Prefixa caminhos `/api/...` com `VITE_API_ORIGIN` quando definido; senão mantém URL relativa. */
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const base = getApiOrigin();
  return base ? `${base}${p}` : p;
}

/**
 * Origem para `io()` (socket.io-client).
 * — Com `VITE_API_ORIGIN`: essa origem.
 * — Em localhost: `http://localhost:3001`.
 * — Caso contrário: `undefined` (mesma origem da página).
 */
export function getSocketIoOrigin(): string | undefined {
  const base = getApiOrigin();
  if (base) return base;
  if (typeof window === 'undefined') return undefined;
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3001';
  // Domínio próprio na VPS (nginx + Node na mesma origem): cliente usa a página actual.
  return undefined;
}
