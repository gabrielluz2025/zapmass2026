/**
 * 35 bairros oficiais de Blumenau (SC) — Prefeitura / divisão administrativa.
 * Usado para agregar o mapa territorial sem milhares de pins individuais.
 */
export const BLUMENAU_OFFICIAL_NEIGHBORHOODS = [
  'Vorstadt',
  'Centro',
  'Ribeirão Fresco',
  'Garcia',
  'Da Glória',
  'Progresso',
  'Valparaíso',
  'Vila Formosa',
  'Jardim Blumenau',
  'Bom Retiro',
  'Velha',
  'Velha Central',
  'Velha Grande',
  'Passo Manso',
  'Salto Weissbach',
  'Do Salto',
  'Escola Agrícola',
  'Água Verde',
  'Vila Nova',
  'Itoupava Seca',
  'Victor Konder',
  'Boa Vista',
  'Ponta Aguda',
  'Nova Esperança',
  'Itoupava Norte',
  'Fortaleza',
  'Tribess',
  'Fortaleza Alta',
  'Fidélis',
  'Salto do Norte',
  'Badenfurt',
  'Testo Salto',
  'Itoupavazinha',
  'Itoupava Central',
  'Vila Itoupava'
] as const;

export type BlumenauOfficialNeighborhood = (typeof BLUMENAU_OFFICIAL_NEIGHBORHOODS)[number];

export function normBlumenauNbKey(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** Variantes comuns no cadastro → nome oficial. */
const NB_ALIASES: Record<string, BlumenauOfficialNeighborhood> = {
  aguaverde: 'Água Verde',
  badenfurt: 'Badenfurt',
  boavista: 'Boa Vista',
  bomretiro: 'Bom Retiro',
  centro: 'Centro',
  dagloria: 'Da Glória',
  gloria: 'Da Glória',
  progresso: 'Progresso',
  valparaiso: 'Valparaíso',
  vilaformosa: 'Vila Formosa',
  jardimblumenau: 'Jardim Blumenau',
  velha: 'Velha',
  velhacentral: 'Velha Central',
  velhagrande: 'Velha Grande',
  passomanso: 'Passo Manso',
  saltoweissbach: 'Salto Weissbach',
  dosalto: 'Do Salto',
  salto: 'Do Salto',
  escolaagricola: 'Escola Agrícola',
  vilanova: 'Vila Nova',
  itoupavaseca: 'Itoupava Seca',
  victorkonder: 'Victor Konder',
  pontaguda: 'Ponta Aguda',
  novaesperanca: 'Nova Esperança',
  itoupavanorte: 'Itoupava Norte',
  fortaleza: 'Fortaleza',
  tribess: 'Tribess',
  fortalezaalta: 'Fortaleza Alta',
  fidelis: 'Fidélis',
  saltodonorte: 'Salto do Norte',
  testosalto: 'Testo Salto',
  itoupavazinha: 'Itoupavazinha',
  itoupavacentral: 'Itoupava Central',
  vilaitoupava: 'Vila Itoupava',
  vorstadt: 'Vorstadt',
  garcia: 'Garcia',
  ribeiraofresco: 'Ribeirão Fresco',
  rondonia: 'Garcia'
};

const MATCH_BY_KEY_LENGTH: Array<{ key: string; official: BlumenauOfficialNeighborhood }> = [
  ...BLUMENAU_OFFICIAL_NEIGHBORHOODS.map((official) => ({
    key: normBlumenauNbKey(official),
    official
  })),
  ...Object.entries(NB_ALIASES).map(([key, official]) => ({ key, official }))
].sort((a, b) => b.key.length - a.key.length);

export function isBlumenauCity(city: string): boolean {
  const base = normBlumenauNbKey(String(city || '').split('·')[0] || city);
  return base.includes('blumenau') || base === 'blumenau';
}

/** Mapeia texto de bairro (cadastro) para um dos 35 oficiais, ou null. */
export function matchOfficialNeighborhood(raw: string): BlumenauOfficialNeighborhood | null {
  const key = normBlumenauNbKey(raw);
  if (!key) return null;
  const direct = NB_ALIASES[key];
  if (direct) return direct;
  for (const { key: mk, official } of MATCH_BY_KEY_LENGTH) {
    if (!mk || mk.length < 3) continue;
    if (key === mk) return official;
    if (key.length >= 5 && mk.length >= 5 && (key.includes(mk) || mk.includes(key))) {
      return official;
    }
  }
  return null;
}

/** Posição estável no mapa (anel ao redor do centro) quando não há geocode. */
export function blumenauSpreadCoord(index: number, total = BLUMENAU_OFFICIAL_NEIGHBORHOODS.length): {
  lat: number;
  lng: number;
} {
  const centerLat = -26.9194;
  const centerLng = -49.0661;
  const angle = (index / total) * 2 * Math.PI;
  const ring = index % 4;
  const radius = 0.009 + ring * 0.006;
  return {
    lat: centerLat + Math.cos(angle) * radius,
    lng: centerLng + Math.sin(angle) * radius * 1.15
  };
}
