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

/** URL efetiva para BullMQ — usa fallback descoberto em runtime se o .env estiver errado. */
export function getEffectiveRedisUrl(): string | null {
  return __resolvedRedisUrl || process.env.REDIS_URL?.trim() || null;
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
  add(primary);
  add(process.env.REDIS_URL);
  add('redis://redis:6379');
  add('redis://127.0.0.1:6379');
  add('redis://host.docker.internal:6379');
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
