import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

function isPrivateOrLoopbackIp(ip: string): boolean {
  const normalized = ip.replace(/^::ffff:/, '').trim();
  if (!normalized || normalized === '::1' || normalized === '127.0.0.1') return true;
  if (normalized.startsWith('10.')) return true;
  if (normalized.startsWith('192.168.')) return true;
  const octets = normalized.match(/^172\.(\d+)\./);
  if (octets) {
    const second = Number(octets[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/** Evolution no Swarm posta de IP privado (overlay Docker) — não aplicar limite agressivo. */
const skipEvolutionWebhookRateLimit = (req: Request): boolean =>
  isPrivateOrLoopbackIp(String(req.ip || ''));

/** Registo e login VPS (por IP). */
export const authRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Muitas tentativas de registo. Tente mais tarde.' }
});

export const authLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Muitas tentativas de login. Aguarde alguns minutos.' }
});

/** Tentativas de login staff por IP (abuse-resistant para instalação multi-tenant). */
export const staffSignInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Muitas tentativas. Tente de novo em alguns minutos.' }
});

/** Resgate de convite + criação de convite (por IP). */
export const workspaceInviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 80,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Limite de pedidos excedido. Tente mais tarde.' }
});

/** Webhooks públicos — limita vandalismo volumétrico (IP efectivo atrás do trust proxy). */
export const mercadoWebhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Webhook: limite temporário ultrapassado.' }
});

/** Webhooks Evolution — tráfego interno (Docker) isento; limite alto para URL pública. */
export const evolutionWebhookLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10_000,
  skip: skipEvolutionWebhookRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Webhook: limite ultrapassado.' }
});
