/** Utilitários de diagnóstico para REDIS_URL (sem expor credenciais). */

export function parseRedisHost(redisUrl: string): string {
  try {
    return new URL(redisUrl).hostname;
  } catch {
    return 'invalid-url';
  }
}

const COMPOSE_MISCONFIGURED_HOSTS = new Set([
  'host.docker.internal',
  'localhost',
  '127.0.0.1',
  '::1',
]);

let __resolvedRedisUrl: string | null = null;

/** Host legado (Swarm) → DNS interno do Compose, preservando /DB. */
export function remapMisconfiguredRedisUrl(url: string): string {
  const u = url?.trim();
  if (!u) return u;
  const host = parseRedisHost(u);
  if (!COMPOSE_MISCONFIGURED_HOSTS.has(host)) return u;
  try {
    const parsed = new URL(u);
    const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    return `redis://redis:6379${path}`;
  } catch {
    return 'redis://redis:6379';
  }
}

export function isMisconfiguredRedisHost(url: string): boolean {
  return COMPOSE_MISCONFIGURED_HOSTS.has(parseRedisHost(url));
}

/** URL efetiva para BullMQ — corrige host legado e usa fallback descoberto em runtime. */
export function getEffectiveRedisUrl(): string | null {
  const raw = __resolvedRedisUrl || process.env.REDIS_URL?.trim() || null;
  if (!raw) return null;
  return remapMisconfiguredRedisUrl(raw);
}

export function setResolvedRedisUrl(url: string): void {
  const u = url?.trim();
  if (u) __resolvedRedisUrl = u;
}

/** URLs candidatas em ordem de preferência (Compose → host publicado → Swarm overlay). */
export function getRedisUrlCandidates(primary?: string | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (url?: string | null) => {
    const u = url?.trim();
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  const envUrl = (primary || process.env.REDIS_URL || '').trim();
  if (envUrl && isMisconfiguredRedisHost(envUrl)) {
    add(remapMisconfiguredRedisUrl(envUrl));
  } else {
    add(envUrl);
  }
  add('redis://redis:6379');
  add('redis://127.0.0.1:6379');
  if (envUrl && isMisconfiguredRedisHost(envUrl)) {
    add(envUrl);
  } else {
    add('redis://host.docker.internal:6379');
  }
  return out;
}

/**
 * Em Docker Compose o serviço Redis escuta em `redis:6379` na rede interna.
 * URLs apontando para localhost/host.docker.internal costumam falhar com "Connection is closed".
 */
export function getRedisUrlMisconfigHint(redisUrl: string): string | null {
  const host = parseRedisHost(redisUrl);
  if (!COMPOSE_MISCONFIGURED_HOSTS.has(host)) return null;
  return `REDIS_URL aponta para "${host}" — no Docker Compose use redis://redis:6379 no .env e rode: docker compose up -d zapmass`;
}
