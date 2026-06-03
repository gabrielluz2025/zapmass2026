import { getFirebaseAdmin } from './firebaseAdmin.js';
import { fetchCampaignDoc, usePostgresCampaigns } from './campaignStore.js';

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

/**
 * Resolve o ownerUid de uma campanha no Firestore.
 * A query antiga `collectionGroup + __name__ == campaigns/{id}` nunca batia
 * (path real: users/{uid}/campaigns/{id}) — pause/resume falhavam apos restart.
 */
export async function lookupCampaignOwnerUidInFirestore(
  campaignId: string,
  candidateOwnerUids: readonly string[]
): Promise<string | null> {
  const cid = String(campaignId || '').trim();
  if (!cid) return null;

  const admin = getFirebaseAdmin();
  if (!admin) return null;

  const db = admin.firestore();
  const seen = new Set<string>();

  for (const raw of candidateOwnerUids) {
    const uid = String(raw || '').trim();
    if (!uid || uid === 'anonymous' || seen.has(uid)) continue;
    seen.add(uid);
    try {
      const snap = await db.collection('users').doc(uid).collection('campaigns').doc(cid).get();
      if (snap.exists) return uid;
    } catch {
      /* tenta proximo candidato */
    }
  }

  return null;
}

/** Postgres (VPS): campanha em `zapmass.campaigns` por tenant_id. */
export async function lookupCampaignOwnerUidInPostgres(
  campaignId: string,
  candidateOwnerUids: readonly string[]
): Promise<string | null> {
  if (!usePostgresCampaigns()) return null;
  const cid = String(campaignId || '').trim();
  if (!cid) return null;
  const seen = new Set<string>();
  for (const raw of candidateOwnerUids) {
    const uid = String(raw || '').trim();
    if (!uid || uid === 'anonymous' || seen.has(uid)) continue;
    seen.add(uid);
    try {
      const doc = await fetchCampaignDoc(uid, cid);
      if (doc) return uid;
    } catch {
      /* tenta proximo candidato */
    }
  }
  return null;
}

/** Firestore ou Postgres conforme modo de dados do deploy. */
export async function lookupCampaignOwnerUidInDatastore(
  campaignId: string,
  candidateOwnerUids: readonly string[]
): Promise<string | null> {
  const fromFs = await lookupCampaignOwnerUidInFirestore(campaignId, candidateOwnerUids);
  if (fromFs) return fromFs;
  return lookupCampaignOwnerUidInPostgres(campaignId, candidateOwnerUids);
}

/** Monta lista de UIDs para busca direta no Firestore (tenant, actor, equipa). */
export function buildCampaignOwnerLookupUids(
  tenantUid: string,
  workspaceMemberUids?: ReadonlySet<string>,
  actingAuthUid?: string
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw?: string) => {
    const uid = String(raw || '').trim();
    if (!uid || uid === 'anonymous' || seen.has(uid)) return;
    seen.add(uid);
    out.push(uid);
  };
  push(tenantUid);
  push(actingAuthUid);
  if (workspaceMemberUids) {
    for (const memberUid of workspaceMemberUids) push(memberUid);
  }
  return out;
}
