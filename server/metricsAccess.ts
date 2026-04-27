import type { NextFunction, Request, Response } from 'express';

/** Remove prefixo IPv4-mapped IPv6. */
function normalizeIp(raw: string | undefined): string {
  if (!raw) return '';
  return raw.replace(/^::ffff:/, '');
}

/**
 * Rede interna típica (Docker overlay, LAN) — não inclui loopback.
 * Prometheus no Swarm usa `api:3001`; o peer costuma ser 10.x / 172.16-31 / 192.168 / ULA IPv6.
 */
function isPrivateNetworkNotLoopback(ip: string): boolean {
  if (!ip || ip === '::1') return false;
  if (ip === '127.0.0.1') return false;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('fd') || ip.startsWith('fc')) return true;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m) {
    const second = Number(m[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

function hasValidMetricsToken(req: Request): boolean {
  const token = process.env.METRICS_TOKEN;
  if (!token) return false;
  return req.headers.authorization === `Bearer ${token}`;
}

/**
 * Em produção: bloqueia `/metrics` e rotas internas expostas à internet.
 * - Tráfego da rede privada (p.ex. scrape Prometheus → `api:3001`) passa sem cabeçalho.
 * - Loopback e clientes com IP público precisam de `Authorization: Bearer METRICS_TOKEN`
 *   (se `METRICS_TOKEN` estiver definido). Sem token definido, loopback/público ficam bloqueados.
 * Responde 404 para não revelar que a rota existe.
 */
export function metricsAccessMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== 'production') {
    next();
    return;
  }
  const ip = normalizeIp(req.socket?.remoteAddress);
  if (isPrivateNetworkNotLoopback(ip)) {
    next();
    return;
  }
  if (hasValidMetricsToken(req)) {
    next();
    return;
  }
  res.status(404).end();
}
