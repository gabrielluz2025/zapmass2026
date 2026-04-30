import rateLimit from 'express-rate-limit';

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

export const infinitePayWebhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Webhook: limite temporário ultrapassado.' }
});

/** Compatível com proxies Evolution antigos sem integração ao ZapMass — principalmente noop. */
export const evolutionWebhookLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 360,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Webhook: limite ultrapassado.' }
});
