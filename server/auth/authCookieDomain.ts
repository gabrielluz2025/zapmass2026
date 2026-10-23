/** Sufixo `; Domain=.example.com` para cookies de auth partilhados entre subdomínios (app, apex, www). */
export function vpsAuthCookieDomainSuffix(): string {
  if (process.env.NODE_ENV !== 'production') return '';

  const candidates: string[] = [
    process.env.PUBLIC_APP_URL,
    process.env.GOOGLE_OAUTH_REDIRECT_URI,
    ...(process.env.ALLOWED_ORIGINS || '').split(',')
  ];

  for (const raw of candidates) {
    const s = raw?.trim();
    if (!s) continue;
    try {
      const url = s.startsWith('http') ? s : `https://${s}`;
      const host = new URL(url).hostname.toLowerCase();
      if (host === 'localhost' || host.endsWith('.localhost') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
        continue;
      }
      const parts = host.split('.');
      if (parts.length < 2) continue;
      const base = parts.slice(-2).join('.');
      return `; Domain=.${base}`;
    } catch {
      continue;
    }
  }
  return '';
}

/**
 * Com `Domain=.zap-mass.com`, o SPA em app.zap-mass.com pode chamar a API no apex (ou vice-versa).
 * POST cross-site não envia cookies `SameSite=Lax`; em produção multi-host usamos `None` + `Secure`.
 */
export function vpsAuthCookieSameSite(): 'Lax' | 'None' {
  if (process.env.NODE_ENV !== 'production') return 'Lax';
  return vpsAuthCookieDomainSuffix() ? 'None' : 'Lax';
}

/** Atributos comuns dos cookies HttpOnly de `/api/auth` (refresh + OAuth transitório). */
export function vpsAuthCookieBaseFlags(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const domain = vpsAuthCookieDomainSuffix();
  const sameSite = vpsAuthCookieSameSite();
  return `Path=/api/auth; HttpOnly; SameSite=${sameSite}${domain}${secure}`;
}
