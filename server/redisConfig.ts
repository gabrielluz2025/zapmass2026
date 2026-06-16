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

/**
 * Em Docker Compose o serviço Redis escuta em `redis:6379` na rede interna.
 * URLs apontando para localhost/host.docker.internal costumam falhar com "Connection is closed".
 */
export function getRedisUrlMisconfigHint(redisUrl: string): string | null {
  const host = parseRedisHost(redisUrl);
  if (!COMPOSE_MISCONFIGURED_HOSTS.has(host)) return null;
  return `REDIS_URL aponta para "${host}" — no Docker Compose use redis://redis:6379 no .env e rode: docker compose up -d zapmass`;
}
