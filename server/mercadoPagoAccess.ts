import { existsSync, readFileSync } from 'fs';

const SECRET_PATHS = [
  '/run/secrets/mercadopago_access_token',
  '/run/secrets/MERCADOPAGO_ACCESS_TOKEN'
];

const MP_API = 'https://api.mercadopago.com';
const HEALTH_TTL_MS = 5 * 60 * 1000;

let cached: string | null | undefined;
let healthCache: MercadoPagoTokenHealth | null = null;
let healthCacheAt = 0;

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, '');
}

/** Remove aspas, prefixo Bearer, BOM e quebras de linha comuns em .env/secrets. */
export function normalizeMercadoPagoAccessToken(raw: string): string {
  let t = stripBom(raw).trim();
  while (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  if (/^Bearer\s+/i.test(t)) {
    t = t.replace(/^Bearer\s+/i, '').trim();
  }
  return t.replace(/[\r\n]+/g, '').trim();
}

export function validateMercadoPagoAccessTokenShape(
  token: string
): { ok: true; mode: 'production' | 'test' } | { ok: false; reason: string } {
  if (!token) return { ok: false, reason: 'vazio' };
  if (token.length < 24) return { ok: false, reason: 'curto demais para ser Access Token' };
  if (token.startsWith('APP_USR-')) {
    if (token.length < 48) {
      return {
        ok: false,
        reason: 'parece Public Key — use o Access Token de Credenciais de produção (APP_USR-…)'
      };
    }
    return { ok: true, mode: 'production' };
  }
  if (token.startsWith('TEST-')) {
    return { ok: true, mode: 'test' };
  }
  return {
    ok: false,
    reason: 'deve começar com APP_USR- (produção) ou TEST- (sandbox)'
  };
}

export type MercadoPagoTokenHealth = {
  configured: boolean;
  valid: boolean;
  prefix?: string;
  mode?: 'production' | 'test';
  userId?: string;
  error?: string;
  source?: 'file' | 'env';
};

function readTokenFromPath(p: string): string | null {
  if (!p || !existsSync(p)) return null;
  try {
    const t = normalizeMercadoPagoAccessToken(readFileSync(p, 'utf8'));
    return t || null;
  } catch {
    return null;
  }
}

/** Ficheiro/secret primeiro (evita env do Swarm com aspas/truncamento); depois MERCADOPAGO_ACCESS_TOKEN. */
function collectMercadoPagoTokenCandidates(): Array<{ token: string; source: 'file' | 'env' }> {
  const seen = new Set<string>();
  const out: Array<{ token: string; source: 'file' | 'env' }> = [];
  const push = (raw: string | null | undefined, source: 'file' | 'env') => {
    if (!raw) return;
    const t = normalizeMercadoPagoAccessToken(raw);
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push({ token: t, source });
  };

  const fileEnv = process.env.MERCADOPAGO_ACCESS_TOKEN_FILE?.trim();
  const filePaths = [...(fileEnv ? [fileEnv] : []), ...SECRET_PATHS];
  for (const p of filePaths) {
    push(readTokenFromPath(p), 'file');
  }
  push(process.env.MERCADOPAGO_ACCESS_TOKEN, 'env');

  return out;
}

let cachedSource: 'file' | 'env' | undefined;

/**
 * Token MP: secret/ficheiro (prioridade), variável de ambiente, ou MERCADOPAGO_ACCESS_TOKEN_FILE.
 */
export function getMercadoPagoAccessToken(): string | null {
  if (cached !== undefined) return cached;

  const candidates = collectMercadoPagoTokenCandidates();
  if (candidates.length === 0) {
    cached = null;
    cachedSource = undefined;
    return null;
  }

  for (const c of candidates) {
    if (validateMercadoPagoAccessTokenShape(c.token).ok) {
      cached = c.token;
      cachedSource = c.source;
      return c.token;
    }
  }

  cached = candidates[0].token;
  cachedSource = candidates[0].source;
  return cached;
}

export function getMercadoPagoAccessTokenSource(): 'file' | 'env' | null {
  getMercadoPagoAccessToken();
  return cachedSource ?? null;
}

export function isMercadoPagoAccessTokenConfigured(): boolean {
  return getMercadoPagoAccessToken() != null;
}

export function requireMercadoPagoAccessToken(): string {
  const t = getMercadoPagoAccessToken();
  if (!t) {
    throw new Error('MERCADOPAGO_ACCESS_TOKEN nao configurado no servidor.');
  }
  const shape = validateMercadoPagoAccessTokenShape(t);
  if (shape.ok === false) {
    throw new Error(`MERCADOPAGO_ACCESS_TOKEN invalido: ${shape.reason}`);
  }
  return t;
}

/** Valida o token junto ao MP (GET /users/me). */
export async function verifyMercadoPagoAccessTokenLive(): Promise<MercadoPagoTokenHealth> {
  const token = getMercadoPagoAccessToken();
  if (!token) return { configured: false, valid: false };

  const prefix = token.slice(0, Math.min(14, token.length));
  const source = getMercadoPagoAccessTokenSource() ?? undefined;
  const shape = validateMercadoPagoAccessTokenShape(token);
  if (shape.ok === false) {
    return { configured: true, valid: false, prefix, source, error: shape.reason };
  }

  try {
    const res = await fetch(`${MP_API}/users/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        typeof data.message === 'string'
          ? data.message
          : typeof data.error === 'string'
            ? data.error
            : `HTTP ${res.status}`;
      return { configured: true, valid: false, prefix, mode: shape.mode, source, error: msg };
    }
    return {
      configured: true,
      valid: true,
      prefix,
      mode: shape.mode,
      source,
      userId: data.id != null ? String(data.id) : undefined
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { configured: true, valid: false, prefix, mode: shape.mode, source, error: msg };
  }
}

export async function getMercadoPagoHealthCached(force = false): Promise<MercadoPagoTokenHealth> {
  if (!force && healthCache && Date.now() - healthCacheAt < HEALTH_TTL_MS) {
    return healthCache;
  }
  healthCache = await verifyMercadoPagoAccessTokenLive();
  healthCacheAt = Date.now();
  return healthCache;
}

export function clearMercadoPagoAccessTokenCacheForTests(): void {
  cached = undefined;
  cachedSource = undefined;
  healthCache = null;
  healthCacheAt = 0;
}
