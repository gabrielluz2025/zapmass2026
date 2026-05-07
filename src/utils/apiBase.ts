const trimSlash = (s: string) => s.replace(/\/+$/, '');

/**
 * Origem absoluta do backend (REST + Socket.IO), sem barra final.
 * Para hosting estático separado (ex.: Firebase) defina no build:
 * `VITE_API_ORIGIN=https://api.seudominio.com`
 * Inclua o domínio do site em `ALLOWED_ORIGINS` no servidor (CORS).
 */
export function getApiOrigin(): string {
  const raw = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.trim();
  if (!raw) return '';
  return trimSlash(raw);
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
  return undefined;
}
