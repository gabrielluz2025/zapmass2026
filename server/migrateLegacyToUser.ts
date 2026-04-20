import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, WriteBatch } from 'firebase-admin/firestore';
import { getFirebaseAdmin } from './firebaseAdmin.js';

type LegacyCollection = 'contacts' | 'contact_lists' | 'campaigns';

interface CliOptions {
  uid?: string;
  email?: string;
  dryRun: boolean;
  deleteLegacy: boolean;
  skipLogs: boolean;
  only?: LegacyCollection;
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = { dryRun: false, deleteLegacy: false, skipLogs: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--uid') out.uid = argv[i + 1];
    if (a === '--email') out.email = argv[i + 1];
    if (a === '--dry-run') out.dryRun = true;
    if (a === '--delete-legacy') out.deleteLegacy = true;
    if (a === '--skip-logs') out.skipLogs = true;
    if (a === '--only') {
      const v = argv[i + 1] as LegacyCollection | undefined;
      if (v === 'contacts' || v === 'contact_lists' || v === 'campaigns') out.only = v;
    }
  }
  return out;
}

function usage(): never {
  console.log(`
Uso:
  npm run migrate:legacy:user -- --uid <UID> [--dry-run] [--delete-legacy]
  npm run migrate:legacy:user -- --email <EMAIL> [--dry-run] [--delete-legacy]

Opcoes:
  --dry-run        Mostra o que faria, sem escrever no Firestore
  --delete-legacy  Remove os documentos antigos apos copiar (use com cuidado)
  --skip-logs      Nao migra subcolecao campaigns/{id}/logs
  --only <col>     Migra apenas uma colecao: contacts | contact_lists | campaigns
`);
  process.exit(1);
}

async function resolveUid(opts: CliOptions): Promise<string> {
  if (opts.uid && opts.uid.trim()) return opts.uid.trim();
  if (!opts.email || !opts.email.trim()) usage();
  const adminApp = getFirebaseAdmin();
  if (!adminApp) throw new Error('Firebase Admin nao configurado.');
  const rec = await getAuth(adminApp).getUserByEmail(opts.email.trim());
  return rec.uid;
}

async function commitBatch(
  batch: WriteBatch,
  writes: number,
  dryRun: boolean,
  label: string
): Promise<void> {
  if (writes === 0) return;
  if (dryRun) {
    console.log(`[DRY-RUN] ${label}: ${writes} operacoes.`);
    return;
  }
  await batch.commit();
  console.log(`[OK] ${label}: ${writes} operacoes.`);
}

async function migrateCollection(
  uid: string,
  collectionName: LegacyCollection,
  dryRun: boolean,
  deleteLegacy: boolean
): Promise<{ copied: number; deleted: number }> {
  const adminApp = getFirebaseAdmin();
  if (!adminApp) throw new Error('Firebase Admin nao configurado.');
  const db = getFirestore(adminApp);

  const legacySnap = await db.collection(collectionName).get();
  if (legacySnap.empty) {
    console.log(`[INFO] ${collectionName}: nada para migrar.`);
    return { copied: 0, deleted: 0 };
  }

  let copied = 0;
  let deleted = 0;
  let writesInBatch = 0;
  let batch = db.batch();

  for (const docSnap of legacySnap.docs) {
    const targetRef = db.collection('users').doc(uid).collection(collectionName).doc(docSnap.id);
    const payload = { ...docSnap.data(), migratedAt: FieldValue.serverTimestamp() };

    batch.set(targetRef, payload, { merge: true });
    writesInBatch++;
    copied++;

    if (deleteLegacy) {
      batch.delete(docSnap.ref);
      writesInBatch++;
      deleted++;
    }

    if (writesInBatch >= 400) {
      await commitBatch(batch, writesInBatch, dryRun, `${collectionName} (chunk)`);
      batch = db.batch();
      writesInBatch = 0;
    }
  }

  await commitBatch(batch, writesInBatch, dryRun, `${collectionName} (final)`);
  return { copied, deleted };
}

async function migrateCampaignLogs(uid: string, dryRun: boolean, deleteLegacy: boolean): Promise<{ copied: number; deleted: number }> {
  const adminApp = getFirebaseAdmin();
  if (!adminApp) throw new Error('Firebase Admin nao configurado.');
  const db = getFirestore(adminApp);

  const campaignsSnap = await db.collection('campaigns').get();
  if (campaignsSnap.empty) return { copied: 0, deleted: 0 };

  let copied = 0;
  let deleted = 0;
  let writesInBatch = 0;
  let batch = db.batch();

  for (const campaignDoc of campaignsSnap.docs) {
    const logsSnap = await campaignDoc.ref.collection('logs').get();
    for (const logDoc of logsSnap.docs) {
      const targetRef = db
        .collection('users')
        .doc(uid)
        .collection('campaigns')
        .doc(campaignDoc.id)
        .collection('logs')
        .doc(logDoc.id);
      batch.set(targetRef, { ...logDoc.data(), migratedAt: FieldValue.serverTimestamp() }, { merge: true });
      writesInBatch++;
      copied++;

      if (deleteLegacy) {
        batch.delete(logDoc.ref);
        writesInBatch++;
        deleted++;
      }

      if (writesInBatch >= 400) {
        await commitBatch(batch, writesInBatch, dryRun, 'campaign logs (chunk)');
        batch = db.batch();
        writesInBatch = 0;
      }
    }
  }

  await commitBatch(batch, writesInBatch, dryRun, 'campaign logs (final)');
  return { copied, deleted };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if ((!opts.uid || !opts.uid.trim()) && (!opts.email || !opts.email.trim())) usage();

  const adminApp = getFirebaseAdmin();
  if (!adminApp) {
    throw new Error('Firebase Admin nao configurado. Defina FIREBASE_SERVICE_ACCOUNT_PATH ou FIREBASE_SERVICE_ACCOUNT_JSON.');
  }

  const uid = await resolveUid(opts);
  console.log(`\n[MIGRATION] Destino: users/${uid}`);
  console.log(`[MIGRATION] Modo: ${opts.dryRun ? 'DRY-RUN' : 'WRITE'}${opts.deleteLegacy ? ' + DELETE LEGACY' : ''}\n`);

  const runContacts = !opts.only || opts.only === 'contacts';
  const runLists = !opts.only || opts.only === 'contact_lists';
  const runCampaigns = !opts.only || opts.only === 'campaigns';

  const contacts = runContacts
    ? await migrateCollection(uid, 'contacts', opts.dryRun, opts.deleteLegacy)
    : { copied: 0, deleted: 0 };
  const lists = runLists
    ? await migrateCollection(uid, 'contact_lists', opts.dryRun, opts.deleteLegacy)
    : { copied: 0, deleted: 0 };
  const campaigns = runCampaigns
    ? await migrateCollection(uid, 'campaigns', opts.dryRun, opts.deleteLegacy)
    : { copied: 0, deleted: 0 };
  const logs = !opts.skipLogs && runCampaigns
    ? await migrateCampaignLogs(uid, opts.dryRun, opts.deleteLegacy)
    : { copied: 0, deleted: 0 };

  console.log('\n=== RESUMO ===');
  console.log(`contacts       copied=${contacts.copied} deleted=${contacts.deleted}`);
  console.log(`contact_lists  copied=${lists.copied} deleted=${lists.deleted}`);
  console.log(`campaigns      copied=${campaigns.copied} deleted=${campaigns.deleted}`);
  console.log(`campaign logs  copied=${logs.copied} deleted=${logs.deleted}`);
  console.log('\nConcluido.\n');
}

main().catch((err) => {
  console.error('[MIGRATION] Falhou:', err?.message || err);
  process.exit(1);
});

