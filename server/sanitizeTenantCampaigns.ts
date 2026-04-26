import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';

type CliOpts = {
  apply: boolean;
  uid?: string;
};

function parseArgs(argv: string[]): CliOpts {
  const out: CliOpts = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    if (a === '--uid') out.uid = argv[i + 1];
  }
  return out;
}

function ownerFromConnectionId(connectionId: string): string | null {
  const id = String(connectionId || '');
  const idx = id.indexOf('__');
  if (idx <= 0) return null;
  return id.slice(0, idx);
}

function inferOwnerFromConnections(rawConnIds: unknown): string | null {
  const ids = Array.isArray(rawConnIds) ? rawConnIds.map((x) => String(x || '')).filter(Boolean) : [];
  if (ids.length === 0) return null;
  const owners = new Set<string>();
  for (const id of ids) {
    const o = ownerFromConnectionId(id);
    if (o) owners.add(o);
  }
  if (owners.size !== 1) return null;
  return Array.from(owners)[0];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const adminApp = getFirebaseAdmin();
  if (!adminApp) {
    throw new Error('Firebase Admin nao configurado. Defina FIREBASE_SERVICE_ACCOUNT_PATH ou FIREBASE_SERVICE_ACCOUNT_JSON.');
  }
  const db = getFirestore(adminApp);

  const targetUids = new Set<string>();
  if (opts.uid && opts.uid.trim()) {
    targetUids.add(opts.uid.trim());
  } else {
    const usersSnap = await db.collection('users').get();
    usersSnap.docs.forEach((d) => targetUids.add(d.id));
  }

  let totalCampaigns = 0;
  let contaminated = 0;
  let ownerFixed = 0;
  let deleted = 0;

  console.log(`[sanitize-tenant] modo=${opts.apply ? 'APPLY' : 'DRY-RUN'} usuarios=${targetUids.size}`);

  for (const uid of targetUids) {
    const campaignsRef = db.collection('users').doc(uid).collection('campaigns');
    const snap = await campaignsRef.get();
    if (snap.empty) continue;

    let uidTotal = 0;
    let uidContam = 0;
    let uidFixOwner = 0;
    let uidDeleted = 0;

    for (const d of snap.docs) {
      uidTotal++;
      totalCampaigns++;
      const raw = d.data() as Record<string, unknown>;
      const ownerUid = typeof raw.ownerUid === 'string' ? raw.ownerUid : '';
      const inferredOwner = inferOwnerFromConnections(raw.selectedConnectionIds);
      const connIds = Array.isArray(raw.selectedConnectionIds)
        ? raw.selectedConnectionIds.map((x) => String(x || '')).filter(Boolean)
        : [];

      let isContaminated = false;
      let reason = '';

      if (ownerUid) {
        if (ownerUid !== uid) {
          isContaminated = true;
          reason = `ownerUid=${ownerUid} != uid=${uid}`;
        }
      } else if (inferredOwner) {
        if (inferredOwner !== uid) {
          isContaminated = true;
          reason = `inferredOwner=${inferredOwner} != uid=${uid}`;
        } else if (opts.apply) {
          await d.ref.update({ ownerUid: uid });
          ownerFixed++;
          uidFixOwner++;
        }
      } else {
        // Sem owner e sem inferencia consistente: registro suspeito.
        // Ex.: selectedConnectionIds vazio ou apenas ids legados sem prefixo uid__.
        isContaminated = true;
        reason = connIds.length === 0 ? 'sem ownerUid e sem selectedConnectionIds' : 'sem ownerUid inferivel';
      }

      if (!isContaminated) continue;

      contaminated++;
      uidContam++;
      console.log(`[contaminated] uid=${uid} campaign=${d.id} reason="${reason}"`);

      if (!opts.apply) continue;

      // Remove logs associados antes de remover a campanha.
      const logsSnap = await d.ref.collection('logs').get().catch(() => null);
      if (logsSnap && !logsSnap.empty) {
        let batch = db.batch();
        let ops = 0;
        for (const logDoc of logsSnap.docs) {
          batch.delete(logDoc.ref);
          ops++;
          if (ops >= 400) {
            await batch.commit();
            batch = db.batch();
            ops = 0;
          }
        }
        if (ops > 0) await batch.commit();
      }

      await d.ref.delete();
      deleted++;
      uidDeleted++;
    }

    if (uidTotal > 0) {
      console.log(
        `[uid:${uid}] campaigns=${uidTotal} contaminated=${uidContam} ownerFixed=${uidFixOwner} deleted=${uidDeleted}`
      );
    }
  }

  console.log('\n=== RESUMO ===');
  console.log(`campaigns total: ${totalCampaigns}`);
  console.log(`contaminated: ${contaminated}`);
  console.log(`ownerUid fixed: ${ownerFixed}`);
  console.log(`deleted: ${deleted}`);
  console.log('\nConcluido.');
}

main().catch((err) => {
  console.error('[sanitize-tenant] erro:', err?.message || err);
  process.exit(1);
});

