/**
 * Pré-aquece Redis `tenant:{tenantId}:optout_set` a partir do Postgres.
 *
 * Uso local:
 *   npm run warmup:optout-cache
 *   npm run warmup:optout-cache -- --tenant <uuid>
 *
 * Uso na VPS:
 *   docker exec -w /app zapmass-zapmass-1 npm run warmup:optout-cache
 */
import dotenv from 'dotenv';
import { closeZapmassPool } from '../server/db/postgres.js';
import {
  warmupOptOutCacheAllTenants,
  warmupOptOutCacheForTenant,
} from '../server/contactOptOutService.js';

dotenv.config();

function parseArgs(argv: string[]) {
  const tenantIdx = argv.indexOf('--tenant');
  const tenant = tenantIdx >= 0 ? argv[tenantIdx + 1]?.trim() : undefined;
  return { tenant };
}

async function main() {
  const { tenant } = parseArgs(process.argv.slice(2));

  if (tenant) {
    const members = await warmupOptOutCacheForTenant(tenant);
    console.log(`[warmup-optout] tenant ${tenant}: ${members} sufixo(s) carregado(s)`);
  } else {
    const stats = await warmupOptOutCacheAllTenants();
    console.log(
      `[warmup-optout] ${stats.tenants} tenant(s), ${stats.members} membro(s) no Redis optout_set`
    );
  }
}

main()
  .catch((e) => {
    console.error('[warmup-optout] erro fatal:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeZapmassPool().catch(() => {});
  });
