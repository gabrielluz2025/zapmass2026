/** Alvo estável para `createPortal` (modais). Evita `document.body` — extensões/CDN podem alterar o body e causar `removeChild` no React. */
export function getModalPortalContainer(): HTMLElement {
  if (typeof document === 'undefined') {
    return null as unknown as HTMLElement;
  }
  return document.getElementById('portal-root') ?? document.body;
}
