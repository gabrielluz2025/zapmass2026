import { publishOwnerEvent } from './whatsappService.js';

export type TenantDataResource = 'campaigns' | 'contacts' | 'contact-lists';

/** Avisa todos os clientes do tenant (notebook, desktop, equipe) que dados mudaram no servidor. */
export function notifyTenantDataChanged(tenantId: string, resource: TenantDataResource): void {
  const tid = String(tenantId || '').trim();
  if (!tid) return;
  publishOwnerEvent(tid, 'tenant-data-changed', {
    resource,
    at: new Date().toISOString()
  });
}
