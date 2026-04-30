import type { Express } from 'express';

/**
 * Atrás de Nginx/Ingress deve activar para `express-rate-limit` e `req.ip` correctos.
 * TRUST_PROXY=1 | true | yes
 * TRUST_PROXY_HOPS=1 (padrão) — primeiro hop (proxy reverso).
 */
export function configureTrustProxy(app: Express): void {
  const raw = (process.env.TRUST_PROXY ?? '').trim().toLowerCase();
  const on = raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  if (!on) return;
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? '1');
  const n =
    Number.isFinite(hops) && hops >= 1 && hops <= 10 ? Math.floor(hops) : 1;
  app.set('trust proxy', n);
  console.log(`[server] trust proxy activo (${n} hop(s)) — atrás de proxy reverso`);
}
