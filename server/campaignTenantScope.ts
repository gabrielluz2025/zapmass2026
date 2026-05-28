/**
 * Escopo de campanha ativa por tenant (dono do workspace ou membro com ownerUid legado).
 */
export function resolveCampaignTenantOwner(
  tenantUid: string,
  campaignOwnerUid: string | undefined,
  workspaceMemberUids?: ReadonlySet<string>,
  actingAuthUid?: string
): string | null {
  const tenant = String(tenantUid || '').trim();
  if (!tenant || tenant === 'anonymous') return null;

  const owner = String(campaignOwnerUid || '').trim();
  const actor = String(actingAuthUid || '').trim();

  if (!owner) return tenant;
  if (owner === tenant) return tenant;
  if (workspaceMemberUids?.has(owner)) return tenant;

  if (actor) {
    if (owner === actor) return tenant;
    if (workspaceMemberUids?.has(actor)) return tenant;
  }

  return null;
}

/** Dono do workspace pode reconciliar ownerUid órfão (legado) quando o set inclui a equipa. */
export function canReconcileLegacyCampaignOwner(
  tenantUid: string,
  campaignOwnerUid: string | undefined,
  workspaceMemberUids?: ReadonlySet<string>
): boolean {
  const tenant = String(tenantUid || '').trim();
  const owner = String(campaignOwnerUid || '').trim();
  if (!tenant || !owner || owner === tenant) return false;
  if (!workspaceMemberUids?.has(tenant)) return false;
  if (workspaceMemberUids.has(owner)) return false;
  return workspaceMemberUids.size > 1;
}
