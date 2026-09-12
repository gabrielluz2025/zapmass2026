/**
 * Relatório por chip para warmup (VPS) — stdout JSON.
 * Uso: ./node_modules/.bin/tsx scripts/warmup-pool-chip-report.ts
 */
import {
  getConnectionConnectedSince,
  getConnections,
  listConnectionOwnerUids,
} from '../server/evolutionService.ts';
import { getChipActivitySnapshot } from '../server/chipProtectionService.ts';
import { resolveChipTier } from '../server/chipTrustScore.ts';
import { filterByConnectionScope } from '../server/connectionScopeServer.ts';

function resolveTenant(): string {
  const fromEnv = String(process.env.ZAPMASS_MONITOR_TENANT_UID || '').trim();
  if (fromEnv) return fromEnv;

  const owners = listConnectionOwnerUids()
    .map((x) => String(x || '').trim())
    .filter(Boolean);

  if (owners.length === 1) return owners[0];

  if (owners.length === 0) {
    throw new Error(
      'Nenhum chip com dono na RAM. Aguarde a API subir ou defina ZAPMASS_MONITOR_TENANT_UID no .env.'
    );
  }

  let best = owners[0];
  let bestN = -1;
  for (const uid of owners) {
    const n = filterByConnectionScope(uid, getConnections()).length;
    if (n > bestN) {
      bestN = n;
      best = uid;
    }
  }
  console.error(
    `[warmup-pool-chip-report] Vários tenants (${owners.length}) — usando ${best} (${bestN} chips). Defina ZAPMASS_MONITOR_TENANT_UID no .env para fixar.`
  );
  return best;
}

function group(row: { inQuarantine: boolean; healthScore: number }): string {
  if (row.inQuarantine) return 'A-quarentena (zero campanha)';
  if (row.healthScore < 30) return 'B-crítico (só warmup)';
  if (row.healthScore >= 80) return 'D-excelente (pode mais volume)';
  return 'C-regular (warmup + piloto leve)';
}

const tenantId = resolveTenant();
const snap = await getChipActivitySnapshot(tenantId);

const chips = snap.connections.map((c) => {
  const since = getConnectionConnectedSince(c.id);
  const tier = resolveChipTier(typeof since === 'number' ? since : undefined);
  return {
    grupo: group(c),
    nome: c.name,
    id: c.id,
    status: c.status,
    score: c.healthScore,
    banda: c.healthBand,
    circuit: c.circuitState,
    quarentena: c.inQuarantine,
    quarentenaAte: c.quarantineUntil,
    tier: tier.label,
    capDia: tier.suggestedDailyCap || 0,
    delayMult: tier.delayMultiplier,
  };
});

chips.sort((a, b) => a.score - b.score);

console.log(
  JSON.stringify(
    { tenantId, chips, recommendations: snap.recommendations },
    null,
    2
  )
);
