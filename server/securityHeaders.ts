import type { RequestHandler } from 'express';

/**
 * Cabeçalhos HTTP básicos para a API (sem dependência extra tipo helmet).
 * Não define CSP aqui: o bundle SPA é servido por outro host (Firebase/Nginx) e o CSP deve alinhar com scripts inline do build.
 */
export const securityHeadersMiddleware: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
};
