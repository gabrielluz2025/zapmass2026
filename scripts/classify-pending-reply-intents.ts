/**
 * Classifica respostas «quero» / «sair» em lote (quente / lista negra), sem reenviar texto do fluxo.
 *
 * Uso na VPS (dentro do container, com .env carregado):
 *   docker exec -w /app zapmass-zapmass-1 npm run classify:pending-replies -- --tenant <firebaseUid>
 *   docker exec -w /app zapmass-zapmass-1 npm run classify:pending-replies -- --tenant <firebaseUid> --dry-run
 */
import dotenv from 'dotenv';
import { closeZapmassPool } from '../server/db/postgres.js';
import { autoApplyReplyIntentsForTenant } from '../server/replyIntentAutoApply.js';

dotenv.config();

function parseArgs(argv: string[]) {
  const tenantIdx = argv.indexOf('--tenant');
  const tenant = tenantIdx >= 0 ? argv[tenantIdx + 1]?.trim() : '';
  const dryRun = argv.includes('--dry-run');
  return { tenant, dryRun };
}

async function main() {
  const { tenant, dryRun } = parseArgs(process.argv.slice(2));
  if (!tenant) {
    console.error('Uso: npm run classify:pending-replies -- --tenant <firebaseUid> [--dry-run]');
    process.exit(1);
  }

  const result = await autoApplyReplyIntentsForTenant(tenant, {
    excludeWarmup: true,
    dryRun,
  });

  console.log(JSON.stringify(result, null, 2));
  if (dryRun) {
    console.log(
      `[classify-pending] dry-run: ${result.eligible} elegível(is) — ${result.appliedHot} quente(s), ${result.appliedBlacklist} lista negra`
    );
  } else {
    console.log(
      `[classify-pending] aplicado: ${result.appliedHot} quente(s), ${result.appliedBlacklist} lista negra` +
        (result.skippedNoContact ? `; ${result.skippedNoContact} sem contato na base` : '')
    );
  }
}

main()
  .catch((e) => {
    console.error('[classify-pending] falhou:', (e as Error)?.message || e);
    process.exit(1);
  })
  .finally(() => closeZapmassPool().catch(() => undefined));
