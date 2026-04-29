/**
 * Checkout Mercado Pago após o POST ao backend devolver init_point/sandbox_init_point.
 *
 * 1. Abre primeiro `about:blank` com dois argumentos (sem noopener/noreferrer) para conseguimos
 *    definir URL após um await sem tab morto.
 * 2. Fallback: top window se estivermos em iframe.
 * 3. Fallback final: mesmo separador (`location.assign`).
 */

function normalizeCheckoutUrl(initPoint: string): string | null {
  let u = String(initPoint ?? '').trim();
  if (!u) return null;
  if (u.startsWith('//')) u = `https:${u}`;
  return u;
}

export function redirectToMercadoPagoCheckout(initPoint: string): void {
  const url = normalizeCheckoutUrl(initPoint);
  if (!url) return;

  const tab = window.open('about:blank', '_blank');
  try {
    if (tab && !tab.closed) {
      tab.location.replace(url);
      return;
    }
  } catch {
    try {
      tab?.close?.();
    } catch {
      /* ignore */
    }
  }

  try {
    if (window.self !== window.top && window.top) {
      window.top.location.assign(url);
      return;
    }
  } catch {
    /* iframe cross-origin: segue para mesmo separador ou link */
  }

  try {
    window.location.assign(url);
  } catch {
    /** Último recurso para ambientes estranhos **/
    try {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      window.location.href = url;
    }
  }
}
