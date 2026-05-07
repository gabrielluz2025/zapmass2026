/** URL base da app SPA (HTTPS), usada nos links WhatsApp das pesquisas ao cliente. */

/** Primeiro URL útil lista em ALLOWED_ORIGINS (prioriza https). */
export function preferredOriginFromAllowedOrigins(): string {
  const raw = (process.env.ALLOWED_ORIGINS || '').trim();
  if (!raw) return '';
  const parts = raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((p) => /^https?:\/\//i.test(p));
  const httpsFirst = parts.find((p) => p.startsWith('https://'));
  if (httpsFirst) return httpsFirst;
  return parts[0] || '';
}

/**
 * Ordem: PUBLIC_APP_URL → APP_PUBLIC_URL → primeiro https (ou primeiro URL) em ALLOWED_ORIGINS.
 * Na VPS/Swarm não confies só em env_file para PUBLIC_APP_URL; ver docker-stack + deployment/vps-deploy.sh.
 */
export function getSurveyLinksBaseOrigin(): string {
  const explicit = (process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (explicit) return explicit;
  return preferredOriginFromAllowedOrigins().replace(/\/+$/, '');
}
