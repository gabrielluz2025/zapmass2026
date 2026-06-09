/**
 * Escopo de tenant no browser (VPS): comparação por UUID Postgres exato.
 * Mapeamento Firebase→UUID v5 fica só no servidor (`server/auth/tenantUidScopeServer.ts`).
 */
export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || '').trim()
  );
}

export function tenantScopeUidsMatch(a: string, b: string): boolean {
  const x = String(a || '').trim();
  const y = String(b || '').trim();
  if (!x || !y) return false;
  return x === y;
}
