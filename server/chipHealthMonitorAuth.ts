import type { Request } from 'express';
import { parseBearer } from './resolveAuth.js';

export function isLoopbackRequest(req: Request): boolean {
  const ip = String(req.socket?.remoteAddress || '').trim();
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function getInternalMonitorKey(): string {
  return String(
    process.env.ZAPMASS_INTERNAL_MONITOR_KEY || process.env.INTERNAL_MONITOR_KEY || ''
  ).trim();
}

/** Header `X-Internal-Secret` ou Bearer com a chave estática do backend. */
export function hasInternalMonitorSecret(req: Request): boolean {
  const key = getInternalMonitorKey();
  if (!key) return false;

  const header = req.headers['x-internal-secret'];
  if (header && String(header).trim() === key) return true;

  const bearer = parseBearer(req);
  if (bearer && bearer === key) return true;

  return false;
}

/**
 * Acesso interno ao summary: loopback (127.0.0.1/::1) ou chave estática.
 * Loopback sozinho não expõe dados à internet — requisição já está na VPS.
 */
export function isChipHealthMonitorInternalAccess(req: Request): boolean {
  if (hasInternalMonitorSecret(req)) return true;
  if (isLoopbackRequest(req)) return true;
  return false;
}

export async function resolveChipHealthMonitorTenantId(): Promise<string | null> {
  const fromEnv = String(process.env.ZAPMASS_MONITOR_TENANT_UID || '').trim();
  if (fromEnv) return fromEnv;

  const evo = await import('./evolutionService.js');
  const owners = evo.listConnectionOwnerUids().map((id) => String(id || '').trim()).filter(Boolean);
  if (owners.length === 1) return owners[0];
  return null;
}

export type ChipHealthMonitorAuth =
  | { mode: 'tenant'; tenantId: string }
  | { mode: 'error'; status: number; error: string };

export async function resolveChipHealthSummaryAccess(
  req: Request
): Promise<ChipHealthMonitorAuth> {
  const internalKey = getInternalMonitorKey();
  const bearer = parseBearer(req);

  if (bearer && (!internalKey || bearer !== internalKey)) {
    const { resolveAuthPrincipal } = await import('./resolveAuth.js');
    const principal = await resolveAuthPrincipal(bearer);
    if (principal) {
      return { mode: 'tenant', tenantId: principal.tenantUid };
    }
  }

  if (!isChipHealthMonitorInternalAccess(req)) {
    return {
      mode: 'error',
      status: 401,
      error: 'Envie Authorization: Bearer (JWT) ou X-Internal-Secret / loopback local.',
    };
  }

  const tenantId = await resolveChipHealthMonitorTenantId();
  if (!tenantId) {
    return {
      mode: 'error',
      status: 400,
      error:
        'Tenant ambíguo para monitor interno. Defina ZAPMASS_MONITOR_TENANT_UID no .env do backend.',
    };
  }

  return { mode: 'tenant', tenantId };
}
