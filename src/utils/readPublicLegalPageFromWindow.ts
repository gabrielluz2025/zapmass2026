export type LegalPageSlug = 'termos' | 'privacidade';

/** Rotas públicas `/termos` e `/privacidade` (sem login). */
export function readPublicLegalPageFromWindow(): LegalPageSlug | null {
  if (typeof window === 'undefined') return null;
  try {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/termos') return 'termos';
    if (path === '/privacidade') return 'privacidade';
    return null;
  } catch {
    return null;
  }
}
