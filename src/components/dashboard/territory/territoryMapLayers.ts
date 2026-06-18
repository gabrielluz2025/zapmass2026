import L from 'leaflet';
import { TEMP_COLOR } from './territoryConstants';
import type { NeighborhoodRow } from './types';

export { paintContactPins, paintNeighborhoodOverviewPins } from './territoryPersonMarkers';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Visão geral — halos por bairro. */
export function paintTerritoryHeat(
  map: L.Map,
  rows: NeighborhoodRow[],
  onSelect: (row: NeighborhoodRow) => void
): L.Layer[] {
  const layers: L.Layer[] = [];
  const maxCount = Math.max(1, ...rows.map((r) => r.count));

  for (const row of rows) {
    if (row.lat == null || row.lng == null || row.count < 1) continue;

    const t = row.count / maxCount;
    const radiusM = Math.round(200 + Math.sqrt(t) * 700);
    const color = TEMP_COLOR[row.dominant];

    const halo = L.circle([row.lat, row.lng], {
      radius: radiusM,
      fillColor: color,
      fillOpacity: 0.42,
      color: color,
      weight: 2,
      opacity: 0.7,
      className: 'zm-atlas-halo',
    });

    const core = L.circleMarker([row.lat, row.lng], {
      radius: Math.round(7 + Math.sqrt(t) * 10),
      fillColor: color,
      fillOpacity: 1,
      color: '#fff',
      weight: 2.5,
      opacity: 1,
      className: 'zm-atlas-core',
    });

    const tip = `<strong>${escapeHtml(row.label)}</strong>
      <span>${row.count.toLocaleString('pt-BR')} contatos — clique para ver no mapa</span>`;

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

export function flyToContactPins(
  map: L.Map,
  pins: { lat: number; lng: number }[]
): void {
  const bounds = L.latLngBounds([]);
  for (const p of pins) {
    bounds.extend([p.lat, p.lng]);
  }
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17, animate: true });
  }
}
