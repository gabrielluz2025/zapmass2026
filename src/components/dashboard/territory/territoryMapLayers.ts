import L from 'leaflet';
import { CONTACT_TEMP_LABEL } from '../../../utils/contactTemperature';
import { TEMP_COLOR } from './territoryConstants';
import type { MapContactPin, NeighborhoodRow } from './types';

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

/** Modo bairro — só contatos individuais. */
export function paintContactPins(
  map: L.Map,
  pins: MapContactPin[],
  selectedId: string | null,
  onSelect: (pin: MapContactPin) => void
): L.Layer[] {
  const layers: L.Layer[] = [];

  for (const pin of pins) {
    const color = TEMP_COLOR[pin.temp];
    const selected = selectedId === pin.id;
    const radius = selected ? 11 : 7;

    const marker = L.circleMarker([pin.lat, pin.lng], {
      radius,
      fillColor: color,
      fillOpacity: 1,
      color: pin.coordVerified ? '#fff' : '#fbbf24',
      weight: pin.coordVerified ? 2.5 : 2,
      opacity: 1,
      className: selected ? 'zm-atlas-pin zm-atlas-pin--active' : 'zm-atlas-pin',
    });

    const addr = [pin.street, pin.number].filter(Boolean).join(', ');
    marker.bindTooltip(
      `<div class="zm-atlas-tip zm-atlas-tip--pin">
        <strong>${escapeHtml(pin.name)}</strong>
        <span>${escapeHtml(CONTACT_TEMP_LABEL[pin.temp])}</span>
        ${addr ? `<span>${escapeHtml(addr)}</span>` : ''}
      </div>`,
      { className: 'zm-atlas-tip-pane', direction: 'top', offset: [0, -6], opacity: 1 }
    );

    marker.on('click', () => onSelect(pin));
    marker.addTo(map);
    layers.push(marker);
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

export function flyToContactPins(map: L.Map, pins: MapContactPin[]): void {
  const bounds = L.latLngBounds([]);
  for (const p of pins) {
    bounds.extend([p.lat, p.lng]);
  }
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 16, animate: true });
  }
}
