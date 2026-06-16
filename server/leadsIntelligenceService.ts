/**
 * Mapa de Inteligência Comercial
 *
 * Cruza a GEOGRAFIA dos contatos (cidade/estado/coordenadas do CRM) com o
 * RESULTADO das campanhas (reportSnapshot por telefone) para responder:
 *   - Onde meus disparos mais convertem? (zonas quentes)
 *   - Onde tenho muitos leads e pouca resposta? (oportunidade desperdiçada)
 *   - Qual a cobertura nacional por estado?
 *
 * 100% gratuito: usa os dados já existentes no banco (contatos + reportSnapshot
 * das campanhas) e coordenadas aproximadas de cidade/UF já embutidas.
 */
import type { Contact } from '../src/types.js';
import { normPhoneKey } from '../src/utils/brPhoneNormalize.js';
import { listCampaigns } from './repositories/campaignsRepository.js';
import {
  loadTenantContacts,
  resolveContactCityState,
  storedContactCoords,
  hydrateContactForGeo
} from './leadsGeoService.js';
import { cityToApproxCoord, ufToCoord, UF_NAMES } from './brazilGeoCentroids.js';

export type RegionTemperature = 'hot' | 'warm' | 'cold' | 'untouched';

export type RegionConversion = {
  key: string;
  label: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  leads: number;
  contacted: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  replyRate: number;
  deliveryRate: number;
  coverageRate: number;
  temperature: RegionTemperature;
  score: number;
};

export type HeatPoint = { lat: number; lng: number; weight: number };

export type CommercialIntelligenceResult = {
  generatedAt: string;
  national: {
    totalLeads: number;
    geoLeads: number;
    contactedLeads: number;
    sent: number;
    delivered: number;
    read: number;
    replied: number;
    failed: number;
    replyRate: number;
    deliveryRate: number;
    coveragePct: number;
    statesCovered: number;
    campaignsConsidered: number;
  };
  byCity: RegionConversion[];
  byState: RegionConversion[];
  heatPoints: HeatPoint[];
  hotZones: RegionConversion[];
  coldZones: RegionConversion[];
};

type Outcome = {
  rank: number;
  failed: boolean;
};

// Prioridade do melhor status alcançado por um contato em qualquer campanha.
const STATUS_RANK: Record<string, number> = {
  REPLIED: 5,
  READ: 4,
  DELIVERED: 3,
  SENT: 2,
  FAILED: 1,
  PENDING: 0
};

function normStatus(s: string): string {
  return String(s || '').trim().toUpperCase();
}

/** Agrega o melhor resultado de cada telefone através de todas as campanhas. */
async function buildPhoneOutcomeMap(
  tenantId: string
): Promise<{ map: Map<string, Outcome>; campaignsConsidered: number }> {
  const campaigns = await listCampaigns(tenantId);
  const map = new Map<string, Outcome>();
  let campaignsConsidered = 0;

  for (const campaign of campaigns) {
    const rows = campaign.reportSnapshot?.rows;
    if (!Array.isArray(rows) || rows.length === 0) continue;
    campaignsConsidered++;
    for (const row of rows) {
      const key = normPhoneKey(row.phone || '');
      if (!key) continue;
      const status = normStatus(row.status);
      const rank = STATUS_RANK[status] ?? 0;
      const failed = status === 'FAILED';
      const prev = map.get(key);
      if (!prev || rank > prev.rank) {
        map.set(key, { rank, failed: failed && (!prev || prev.rank <= 1) });
      }
    }
  }
  return { map, campaignsConsidered };
}

function emptyRegion(key: string, label: string, city: string, state: string): RegionConversion {
  return {
    key,
    label,
    city,
    state,
    lat: null,
    lng: null,
    leads: 0,
    contacted: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    replied: 0,
    failed: 0,
    replyRate: 0,
    deliveryRate: 0,
    coverageRate: 0,
    temperature: 'untouched',
    score: 0
  };
}

/** Acumula o resultado (funil cumulativo) de um contato dentro da sua região. */
function accumulateOutcome(region: RegionConversion, outcome: Outcome | undefined): void {
  region.leads++;
  if (!outcome) return;
  region.contacted++;
  if (outcome.failed) region.failed++;
  // Funil cumulativo: READ implica DELIVERED implica SENT, etc.
  if (outcome.rank >= STATUS_RANK.SENT) region.sent++;
  if (outcome.rank >= STATUS_RANK.DELIVERED) region.delivered++;
  if (outcome.rank >= STATUS_RANK.READ) region.read++;
  if (outcome.rank >= STATUS_RANK.REPLIED) region.replied++;
}

function finalizeRegion(r: RegionConversion): void {
  r.replyRate = r.sent > 0 ? r.replied / r.sent : 0;
  r.deliveryRate = r.sent > 0 ? r.delivered / r.sent : 0;
  r.coverageRate = r.leads > 0 ? r.contacted / r.leads : 0;

  if (r.contacted === 0) {
    r.temperature = 'untouched';
  } else if (r.replyRate >= 0.15 && r.contacted >= 3) {
    r.temperature = 'hot';
  } else if (r.replyRate >= 0.05) {
    r.temperature = 'warm';
  } else {
    r.temperature = 'cold';
  }

  // Score combina taxa de resposta (peso forte) com volume de leads (log) — para
  // priorizar regiões que convertem E têm escala.
  const volumeFactor = Math.log10(r.leads + 1);
  r.score = Math.round((r.replyRate * 100 + volumeFactor * 5) * 10) / 10;
}

export async function buildCommercialIntelligence(
  tenantId: string
): Promise<CommercialIntelligenceResult> {
  const [contacts, outcomeData] = await Promise.all([
    loadTenantContacts(tenantId),
    buildPhoneOutcomeMap(tenantId)
  ]);
  const { map: outcomeMap, campaignsConsidered } = outcomeData;

  const cityRegions = new Map<string, RegionConversion>();
  const stateRegions = new Map<string, RegionConversion>();
  const heatPoints: HeatPoint[] = [];
  const MAX_HEAT = 6000;

  let geoLeads = 0;

  for (const raw of contacts) {
    const c: Contact = hydrateContactForGeo(raw);
    const { city, state } = resolveContactCityState(c);
    if (!state && !city) continue;
    geoLeads++;

    const phoneKey = normPhoneKey(c.phone || '');
    const outcome = phoneKey ? outcomeMap.get(phoneKey) : undefined;

    // ── Região por estado ───────────────────────────────────────────────
    if (state) {
      const sk = state.toUpperCase();
      let sr = stateRegions.get(sk);
      if (!sr) {
        sr = emptyRegion(`uf:${sk}`, UF_NAMES[sk] || sk, '', sk);
        const coord = ufToCoord(sk);
        if (coord) {
          sr.lat = coord.lat;
          sr.lng = coord.lng;
        }
        stateRegions.set(sk, sr);
      }
      accumulateOutcome(sr, outcome);
    }

    // ── Região por cidade ───────────────────────────────────────────────
    if (city) {
      const ck = `${city.toLowerCase()}|${(state || '').toLowerCase()}`;
      let cr = cityRegions.get(ck);
      if (!cr) {
        cr = emptyRegion(
          `city:${ck}`,
          state ? `${city} · ${state}` : city,
          city,
          state || ''
        );
        const coord = cityToApproxCoord(city, state || '');
        if (coord) {
          cr.lat = coord.lat;
          cr.lng = coord.lng;
        }
        cityRegions.set(ck, cr);
      }
      accumulateOutcome(cr, outcome);
    }

    // ── Ponto de calor (coordenada real do contato, ou aproximada da cidade) ──
    if (heatPoints.length < MAX_HEAT) {
      const stored = storedContactCoords(c);
      const base = stored || (city ? cityToApproxCoord(city, state || '') : null);
      if (base) {
        // Contatos que responderam pesam mais no heatmap.
        const weight = outcome && outcome.rank >= STATUS_RANK.REPLIED ? 1 : 0.4;
        heatPoints.push({ lat: base.lat, lng: base.lng, weight });
      }
    }
  }

  const cityList = [...cityRegions.values()];
  const stateList = [...stateRegions.values()];
  cityList.forEach(finalizeRegion);
  stateList.forEach(finalizeRegion);

  // ── Totais nacionais ──────────────────────────────────────────────────
  const national = stateList.reduce(
    (acc, r) => {
      acc.contactedLeads += r.contacted;
      acc.sent += r.sent;
      acc.delivered += r.delivered;
      acc.read += r.read;
      acc.replied += r.replied;
      acc.failed += r.failed;
      return acc;
    },
    {
      contactedLeads: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      failed: 0
    }
  );

  const statesCovered = stateList.filter((r) => r.contacted > 0).length;

  // ── Zonas quentes: melhor taxa de resposta com volume mínimo ──────────
  const MIN_HOT_CONTACTED = 3;
  const hotZones = cityList
    .filter((r) => r.contacted >= MIN_HOT_CONTACTED && r.replied > 0)
    .sort((a, b) => b.replyRate - a.replyRate || b.replied - a.replied)
    .slice(0, 8);

  // ── Zonas frias / oportunidade: muitos leads, baixa conversão/cobertura ──
  const coldZones = cityList
    .filter((r) => r.leads >= 5 && (r.contacted === 0 || r.replyRate < 0.03))
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    national: {
      totalLeads: contacts.length,
      geoLeads,
      contactedLeads: national.contactedLeads,
      sent: national.sent,
      delivered: national.delivered,
      read: national.read,
      replied: national.replied,
      failed: national.failed,
      replyRate: national.sent > 0 ? national.replied / national.sent : 0,
      deliveryRate: national.sent > 0 ? national.delivered / national.sent : 0,
      coveragePct: geoLeads > 0 ? national.contactedLeads / geoLeads : 0,
      statesCovered,
      campaignsConsidered
    },
    byCity: cityList.sort((a, b) => b.score - a.score).slice(0, 500),
    byState: stateList.sort((a, b) => b.leads - a.leads),
    heatPoints,
    hotZones,
    coldZones
  };
}
