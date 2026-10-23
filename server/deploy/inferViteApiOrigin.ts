/** Mantém paridade com `deployment/infer-vite-api-origin.sh` (testes + documentação). */

function hostFromUrl(raw: string): string {
  const u = raw.trim().replace(/\r/g, '');
  const withScheme = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  try {
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function truthy(v: string | undefined): boolean {
  if (!v) return false;
  const n = v.trim().toLowerCase();
  return n === '1' || n === 'true' || n === 'yes' || n === 'on';
}

/**
 * Só infere API cross-host quando `ZAPMASS_CROSS_HOST_API=1` (painel e callback OAuth em hosts diferentes).
 * Preferir callback no mesmo host do painel (sem `VITE_API_ORIGIN`).
 */
export function inferViteApiOriginIfNeeded(env: {
  VITE_API_ORIGIN?: string;
  PUBLIC_APP_URL?: string;
  GOOGLE_OAUTH_REDIRECT_URI?: string;
  ZAPMASS_CROSS_HOST_API?: string;
}): string | undefined {
  if (env.VITE_API_ORIGIN?.trim()) {
    return env.VITE_API_ORIGIN.trim().replace(/\/+$/, '');
  }
  if (!truthy(env.ZAPMASS_CROSS_HOST_API)) {
    return undefined;
  }
  const pub = env.PUBLIC_APP_URL?.trim() || '';
  const red = env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || '';
  if (!pub || !red) return undefined;
  const pubHost = hostFromUrl(pub);
  const redHost = hostFromUrl(red);
  if (!pubHost || !redHost || pubHost === redHost) return undefined;
  return `https://${redHost}`;
}
