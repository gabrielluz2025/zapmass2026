import * as XLSX from 'xlsx';
import type { GeoLayer, LeadsGeoQuery, LeadsGeoSummary } from '../services/leadsGeoApi';

const LAYER_LABELS: Record<GeoLayer, string> = {
  ddd: 'DDD',
  city: 'Cidade',
  neighborhood: 'Bairro',
  state: 'UF'
};

function sortedRecordRows(rec: Record<string, number>): (string | number)[][] {
  return Object.entries(rec)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => [label, count]);
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
    .toLowerCase() || 'todos';
}

export function exportLeadsGeoXlsx(
  summary: LeadsGeoSummary,
  opts: { query: LeadsGeoQuery; layer: GeoLayer }
): number {
  const { stats, clusters, topConcentration, pinStats, contactPins } = summary;
  const filtered = stats.filteredTotal || 1;
  const day = new Date().toISOString().slice(0, 10);

  const resumoRows: (string | number)[][] = [
    ['Relatório — Onde moram seus leads', ''],
    ['Gerado em', new Date().toLocaleString('pt-BR')],
    ['', ''],
    ['Filtros', ''],
    ['Camada', LAYER_LABELS[opts.layer]],
    ['UF', opts.query.state || 'Todas'],
    ['DDD', opts.query.ddd || 'Todos'],
    ['Cidade', opts.query.city || 'Todas'],
    ['Bairro', opts.query.neighborhood || 'Todos'],
    ['', ''],
    ['Totais', ''],
    ['Contatos no filtro', stats.filteredTotal],
    ['Total na base', stats.totalContacts],
    ['Com telefone', stats.withPhone],
    ['Com cidade', stats.withCity],
    ['Com bairro', stats.withNeighborhood],
    ['Endereço completo (rua+nº)', pinStats?.withFullAddress ?? 0],
    ['Contatos no mapa (coordenadas)', pinStats?.pinsMapped ?? 0],
    ['Pendentes de localização', pinStats?.pinsPending ?? 0],
    ['Regiões na camada', stats.clusters],
    ['', ''],
    ['Maior concentração', topConcentration?.label || '—'],
    ['Contatos (maior)', topConcentration?.count ?? 0],
    ['% do filtro (maior)', topConcentration?.sharePct ?? 0]
  ];

  const rankingHeader = [
    '#',
    'Região',
    'Cidade',
    'UF',
    'Bairro',
    'DDD',
    'Contatos',
    '% do filtro',
    'Latitude',
    'Longitude',
    'No mapa',
    'Exemplos de nomes'
  ];
  const rankingRows = clusters.map((c, i) => [
    i + 1,
    c.label,
    c.city !== '—' ? c.city : '',
    c.state !== '—' ? c.state : '',
    c.neighborhood !== '—' ? c.neighborhood : '',
    c.ddd !== '—' ? c.ddd : '',
    c.count,
    Math.round((1000 * c.count) / filtered) / 10,
    c.lat ?? '',
    c.lng ?? '',
    c.mapped ? 'Sim' : 'Não',
    (c.sampleNames || []).slice(0, 3).join(', ')
  ]);

  const pinsHeader = [
    'Nome',
    'Cidade',
    'UF',
    'Bairro',
    'Rua',
    'Número',
    'Precisão',
    'Latitude',
    'Longitude'
  ];
  const pinsRows = (contactPins || []).map((p) => [
    p.name,
    p.city,
    p.state,
    p.neighborhood,
    p.street,
    p.number,
    p.precision,
    p.lat,
    p.lng
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumoRows), 'Resumo');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([rankingHeader, ...rankingRows]),
    `Ranking_${LAYER_LABELS[opts.layer]}`
  );

  if (Object.keys(summary.byCity).length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['Cidade', 'Contatos'], ...sortedRecordRows(summary.byCity)]),
      'Por_Cidade'
    );
  }
  if (Object.keys(summary.byNeighborhood).length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['Bairro', 'Contatos'], ...sortedRecordRows(summary.byNeighborhood)]),
      'Por_Bairro'
    );
  }
  if (Object.keys(summary.byDdd).length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['DDD', 'Contatos'], ...sortedRecordRows(summary.byDdd)]),
      'Por_DDD'
    );
  }
  if (Object.keys(summary.byState).length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['UF', 'Contatos'], ...sortedRecordRows(summary.byState)]),
      'Por_UF'
    );
  }
  if (pinsRows.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([pinsHeader, ...pinsRows]),
      'Contatos_no_mapa'
    );
  }

  const slugParts = [
    opts.query.state,
    opts.query.city?.split('·')[0]?.trim(),
    opts.query.neighborhood?.split('·')[0]?.trim(),
    LAYER_LABELS[opts.layer]
  ].filter(Boolean);
  const fname = `leads_geo_${slugify(slugParts.join('_') || 'geral')}_${day}.xlsx`;
  XLSX.writeFile(wb, fname);
  return clusters.length;
}
