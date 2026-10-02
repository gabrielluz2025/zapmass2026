/**
 * Resolve o tenant Postgres dono de uma campanha para jobs BullMQ / runtime.
 * Aceita Firebase UID, UUID derivado ou UUID canônico (expandTenantScopeUids).
 */
import { expandTenantScopeUids } from './auth/tenantUidScopeServer.js';
import { getCampaignDoc, resolveCampaignTenantId } from './repositories/campaignsRepository.js';

export async function resolveRegisteredCampaignOwner(
  campaignId: string,
  hintOwnerUid?: string,
  opts?: {
    isDeleted?: (id: string) => boolean;
    ownerFromRuntime?: (id: string) => string | undefined;
  }
): Promise<string | null> {
  const cid = String(campaignId || '').trim();
  if (!cid || opts?.isDeleted?.(cid)) return null;

  // Fonte mais confiável: tenant_id na linha da campanha (não depende do UID do job).
  const tenantFromRow = await resolveCampaignTenantId(cid).catch(() => null);
  if (tenantFromRow) {
    const doc = await getCampaignDoc(tenantFromRow, cid).catch(() => null);
    if (doc) return tenantFromRow;
    // Linha existe (tenant_id resolvido) — não tratar como órfã se doc.json falhar momentaneamente.
    return tenantFromRow;
  }

  const hints = new Set<string>();
  const hint = String(hintOwnerUid || '').trim();
  if (hint) hints.add(hint);
  const runtimeOwner = opts?.ownerFromRuntime?.(cid);
  if (runtimeOwner) hints.add(String(runtimeOwner).trim());

  for (const h of hints) {
    if (!h) continue;
    for (const candidate of expandTenantScopeUids(h)) {
      const doc = await getCampaignDoc(candidate, cid).catch(() => null);
      if (doc) return tenantFromRow || candidate;
    }
  }

  return null;
}
