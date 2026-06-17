import type { Request } from 'express';

function normalizeIp(raw: string | undefined): string {
  if (!raw) return '';
  return raw.replace(/^::ffff:/, '').trim();
}

export function isPrivateOrLoopbackIp(ip: string): boolean {
  if (!ip || ip === '::1' || ip === '127.0.0.1') return true;
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

/** IP público do cliente (atrás de proxy reverso com trust proxy activo). */
export function getClientIp(req: Request): string {
  const fromExpress = normalizeIp(req.ip);
  if (fromExpress && !isPrivateOrLoopbackIp(fromExpress)) return fromExpress;

  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string') {
    for (const part of xf.split(',')) {
      const candidate = normalizeIp(part);
      if (candidate && !isPrivateOrLoopbackIp(candidate)) return candidate;
    }
  }

  const socketIp = normalizeIp(req.socket?.remoteAddress);
  if (socketIp && !isPrivateOrLoopbackIp(socketIp)) return socketIp;
  return socketIp || fromExpress || '';
}
