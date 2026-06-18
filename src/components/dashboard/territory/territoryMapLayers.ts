import L from 'leaflet';
import { TEMP_COLOR } from './territoryConstants';
import type { NeighborhoodRow } from './types';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Halos suaves no mapa — sem labels, sem pills. */
export function paintTerritoryHeat(
  map: L.Map,
  rows: NeighborhoodRow[],
  selectedKey: string | null,
  onSelect: (row: NeighborhoodRow) => void
): L.Layer[] {
  const layers: L.Layer[] = [];
  const maxCount = Math.max(1, ...rows.map((r) => r.count));

  for (const row of rows) {
    if (row.lat == null || row.lng == null || row.count < 1) continue;

    const t = row.count / maxCount;
    const radiusM = Math.round(280 + Math.sqrt(t) * 920);
    const selected = selectedKey === row.key;
    const color = TEMP_COLOR[row.dominant];

    const halo = L.circle([row.lat, row.lng], {
      radius: radiusM,
      fillColor: color,
      fillOpacity: selected ? 0.38 : 0.22,
      color: selected ? color : 'transparent',
      weight: selected ? 2 : 0,
      opacity: selected ? 0.85 : 0,
      className: selected ? 'zm-atlas-halo zm-atlas-halo--active' : 'zm-atlas-halo',
    });

    const core = L.circleMarker([row.lat, row.lng], {
      radius: Math.round(5 + Math.sqrt(t) * 9),
      fillColor: color,
      fillOpacity: selected ? 1 : 0.88,
      color: '#fff',
      weight: selected ? 3 : 2,
      opacity: 1,
      className: selected ? 'zm-atlas-core zm-atlas-core--active' : 'zm-atlas-core',
    });

    const tip = `<strong>${escapeHtml(row.label)}</strong>
      <span>${row.count.toLocaleString('pt-BR')} contatos</span>
      <span>${row.hot} quente · ${row.warm} morno · ${row.cold} frio</span>`;

    core.bindTooltip(`<div class="zm-atlas-tip">${tip}</div>`, {
      className: 'zm-atlas-tip-pane',
      direction: 'top',
      offset: [0, -4],
      opacity: 1,
    });

    const pick = () => onSelect(row);
    halo.on('click', pick);
    core.on('click', pick);
    halo.addTo(map);
    core.addTo(map);
    layers.push(halo, core);
  }

  return layers;
}

export function flyToNeighborhoodRows(map: L.Map, rows: NeighborhoodRow[]): void {
  const bounds = L.latLngBounds([]);
  for (const row of rows) {
    if (row.lat != null && row.lng != null && row.count > 0) {
      bounds.extend([row.lat, row.lng]);
    }
  }
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: true });
  }
}
