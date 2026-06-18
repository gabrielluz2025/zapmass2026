import L from 'leaflet';
import { CONTACT_TEMP_LABEL } from '../../../utils/contactTemperature';
import { TEMP_COLOR } from './territoryConstants';
import type { NeighborhoodRow } from './types';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function paintTerritoryCircles(
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
    const radius = Math.round(7 + Math.sqrt(t) * 14);
    const selected = selectedKey === row.key;
    const color = TEMP_COLOR[row.dominant];

    const circle = L.circleMarker([row.lat, row.lng], {
      radius,
      fillColor: color,
      fillOpacity: selected ? 0.72 : 0.45,
      color: selected ? '#fafafa' : color,
      weight: selected ? 2.5 : 1,
      opacity: selected ? 1 : 0.65,
      className: selected ? 'zm-geo-marker zm-geo-marker--active' : 'zm-geo-marker',
    });

    circle.bindTooltip(
      `<div class="zm-geo-tip">
        <strong>${escapeHtml(row.label)}</strong>
        <span>${row.count.toLocaleString('pt-BR')} contatos</span>
        ${row.hot ? `<span>${row.hot} quente${row.hot !== 1 ? 's' : ''}</span>` : ''}
        ${row.warm ? `<span>${row.warm} morno${row.warm !== 1 ? 's' : ''}</span>` : ''}
        ${row.cold ? `<span>${row.cold} frio${row.cold !== 1 ? 's' : ''}</span>` : ''}
      </div>`,
      {
        className: 'zm-geo-tip-pane',
        direction: 'top',
        offset: [0, -6],
        opacity: 1,
      }
    );

    circle.on('click', () => onSelect(row));
    circle.addTo(map);
    layers.push(circle);

    if (selected) {
      const ring = L.circleMarker([row.lat, row.lng], {
        radius: radius + 8,
        fillColor: color,
        fillOpacity: 0.12,
        color: color,
        weight: 1,
        opacity: 0.5,
        interactive: false,
        className: 'zm-geo-marker-ring',
      });
      ring.addTo(map);
      layers.push(ring);
    }
  }

  return layers;
}

export function flyToNeighborhoodRows(map: L.Map, rows: NeighborhoodRow[], cityKey: string): void {
  const bounds = L.latLngBounds([]);
  for (const row of rows) {
    if (row.lat != null && row.lng != null && row.count > 0) {
      bounds.extend([row.lat, row.lng]);
    }
  }
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14, animate: true });
  }
}
