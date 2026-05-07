const TOKEN_RE = /^[a-f0-9]{40}$/i;

/** Token na rota pública `/avaliacao?t=…` — lógico leve para decidir fork da app sem puxar o chunk da página. */
export function readClientSurveyTokenFromWindow(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path !== '/avaliacao') return null;
    const t = (new URLSearchParams(window.location.search).get('t') || '').trim();
    return TOKEN_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}
