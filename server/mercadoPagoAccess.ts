import { existsSync, readFileSync } from 'fs';

const SECRET_PATHS = [
  '/run/secrets/mercadopago_access_token',
  '/run/secrets/MERCADOPAGO_ACCESS_TOKEN'
];

let cached: string | null | undefined;

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, '').trim();
}

/**
 * Token MP: variável de ambiente, ficheiro (MERCADOPAGO_ACCESS_TOKEN_FILE) ou secret em /run/secrets.
 * Útil em Swarm/Compose quando a env não chega ao contentor mas há volume ./secrets → /run/secrets.
 */
export function getMercadoPagoAccessToken(): string | null {
  if (cached !== undefined) return cached;

  const fromEnv = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (fromEnv) {
    cached = fromEnv;
    return fromEnv;
  }

  const fileEnv = process.env.MERCADOPAGO_ACCESS_TOKEN_FILE?.trim();
  const paths = [...(fileEnv ? [fileEnv] : []), ...SECRET_PATHS];

  for (const p of paths) {
    if (p && existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf8');
        const t = stripBom(raw);
        if (t) {
          cached = t;
          return t;
        }
      } catch {
        /* ignora */
      }
    }
  }

  cached = null;
  return null;
}

export function isMercadoPagoAccessTokenConfigured(): boolean {
  return getMercadoPagoAccessToken() != null;
}

export function requireMercadoPagoAccessToken(): string {
  const t = getMercadoPagoAccessToken();
  if (!t) {
    throw new Error('MERCADOPAGO_ACCESS_TOKEN nao configurado no servidor.');
  }
  return t;
}

export function clearMercadoPagoAccessTokenCacheForTests(): void {
  cached = undefined;
}
