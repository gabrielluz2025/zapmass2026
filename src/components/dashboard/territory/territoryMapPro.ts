import L from 'leaflet';
import 'leaflet.heat';
import type { ContactTemperature } from '../../../utils/contactTemperature';
import { CONTACT_TEMP_LABEL } from '../../../utils/contactTemperature';
import { TEMP_COLOR, type TerritoryViewMode } from './territoryConstants';
import { formatCompactCount } from './territoryMapUtils';
import { territoryMicroPillIcon, territoryTooltipHtml } from './territoryMapMarkers';
import { paintContactPins } from './territoryPersonMarkers';
import type { MapContactPin, NeighborhoodRow } from './types';

export { paintContactPins };

type HeatLayerInstance = L.Layer;
const heatLayerFactory = (
  L as unknown as {
    heatLayer: (
      latlngs: Array<[number, number, number?]>,
      options?: {
        radius?: number;
        blur?: number;
        maxZoom?: number;
        max?: number;
        minOpacity?: number;
        gradient?: Record<number, string>;
      }
    ) => HeatLayerInstance;
  }
).heatLayer;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escala de volume (frio → quente) para halos e bolhas. */
export function volumeHeatColor(count: number, maxCount: number, isTop = false): string {
  if (isTop) return '#ef4444';
  const t = maxCount > 0 ? Math.min(1, count / maxCount) : 0;
  if (t >= 0.72) return '#f97316';
  if (t >= 0.45) return '#eab308';
  if (t >= 0.2) return '#22d3ee';
  return '#14b8a6';
}

function rowColor(row: NeighborhoodRow, maxCount: number, viewMode: TerritoryViewMode): string {
  if (viewMode === 'volume') return volumeHeatColor(row.count, maxCount, row.index === 1);
  return TEMP_COLOR[row.dominant];
}

function tempMixLine(row: NeighborhoodRow): string {
  const parts: string[] = [];
  if (row.hot > 0) parts.push(`${row.hot} quente`);
  if (row.warm > 0) parts.push(`${row.warm} morno`);
  if (row.cold > 0) parts.push(`${row.cold} frio`);
  if (row.new > 0) parts.push(`${row.new} sem hist.`);
  return parts.slice(0, 3).join(' · ');
}

function bubbleSize(count: number, maxCount: number): number {
  const t = maxCount > 0 ? Math.min(1, Math.sqrt(count / maxCount)) : 0;
  return Math.round(30 + t * 34);
}

function territoryBubbleIcon(
  row: NeighborhoodRow,
  maxCount: number,
  viewMode: TerritoryViewMode,
  selected: boolean
): L.DivIcon {
  const size = bubbleSize(row.count, maxCount);
  const color = rowColor(row, maxCount, viewMode);
  const countLabel = formatCompactCount(row.count) || String(row.count);
  const selectedCls = selected ? ' zm-territory-bubble--selected' : '';

  return L.divIcon({
    className: 'zm-territory-bubble-wrap',
    html: `<div class="zm-territory-bubble${selectedCls}" style="--bubble-size:${size}px;--bubble-color:${color}" role="button" tabindex="0">
      <span class="zm-territory-bubble__ring"></span>
      <span class="zm-territory-bubble__count">${escapeHtml(countLabel)}</span>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2)],
  });
}

function bindNeighborhoodPopup(
  layer: L.Layer,
  row: NeighborhoodRow,
  viewMode: TerritoryViewMode
): void {
  const mix = tempMixLine(row);
  const html = `<div class="zm-territory-popup">
    <strong>${escapeHtml(row.label)}</strong>
    <p>${row.count.toLocaleString('pt-BR')} contatos</p>
    ${mix ? `<p style="opacity:.75;font-size:11px;margin:4px 0 0">${escapeHtml(mix)}</p>` : ''}
    <p style="opacity:.6;font-size:10px;margin:6px 0 0">Clique para abrir o bairro</p>
  </div>`;
  layer.bindPopup(html, { className: 'zm-territory-popup', maxWidth: 260 });
}

/** Halos de densidade por bairro — visão analítica. */
export function paintNeighborhoodHeat(
  target: L.Map | L.LayerGroup,
  rows: NeighborhoodRow[],
  viewMode: TerritoryViewMode,
  onSelect: (row: NeighborhoodRow) => void
): L.Layer[] {
  const layers: L.Layer[] = [];
  const maxCount = Math.max(1, ...rows.map((r) => r.count));

  for (const row of rows) {
    if (row.lat == null || row.lng == null || row.count < 1) continue;

    const t = row.count / maxCount;
    const radiusM = Math.round(220 + Math.sqrt(t) * 820);
    const color = rowColor(row, maxCount, viewMode);

    const halo = L.circle([row.lat, row.lng], {
      radius: radiusM,
      fillColor: color,
      fillOpacity: viewMode === 'volume' ? 0.38 : 0.42,
      color,
      weight: 2,
      opacity: 0.65,
      className: 'zm-atlas-halo',
    });

    const core = L.circleMarker([row.lat, row.lng], {
      radius: Math.round(6 + Math.sqrt(t) * 12),
      fillColor: color,
      fillOpacity: 1,
      color: '#fff',
      weight: 2.5,
      opacity: 1,
      className: 'zm-atlas-core',
    });

    const tip = territoryTooltipHtml(row.label, row.count, row.dominant, tempMixLine(row));
    core.bindTooltip(tip, {
      className: 'zm-territory-tip-pane',
      direction: 'top',
      offset: [0, -6],
      opacity: 1,
      sticky: true,
    });

    const pick = () => onSelect(row);
    halo.on('click', pick);
    core.on('click', pick);
    bindNeighborhoodPopup(core, row, viewMode);
    halo.addTo(target);
    core.addTo(target);
    layers.push(halo, core);
  }

  return layers;
}

/** Bolhas numeradas — visão executiva. */
export function paintNeighborhoodBubbles(
  target: L.Map | L.LayerGroup,
  rows: NeighborhoodRow[],
  selectedKey: string | null,
  viewMode: TerritoryViewMode,
  onSelect: (row: NeighborhoodRow) => void
): L.Layer[] {
  const layers: L.Layer[] = [];
  const maxCount = Math.max(1, ...rows.map((r) => r.count));

  for (const row of rows) {
    if (row.lat == null || row.lng == null || row.count < 1) continue;

    const selected = selectedKey === row.key;
    const marker = L.marker([row.lat, row.lng], {
      icon: territoryBubbleIcon(row, maxCount, viewMode, selected),
      zIndexOffset: selected ? 400 : 100 + (row.count > 0 ? Math.min(200, row.count) : 0),
    });

    marker.bindTooltip(territoryTooltipHtml(row.label, row.count, row.dominant, tempMixLine(row)), {
      className: 'zm-territory-tip-pane',
      direction: 'top',
      offset: [0, -8],
      opacity: 1,
      sticky: true,
    });

    bindNeighborhoodPopup(marker, row, viewMode);
    marker.on('click', () => onSelect(row));
    marker.addTo(target);
    layers.push(marker);
  }

  return layers;
}

/** Rótulos compactos — visão de exploração. */
export function paintNeighborhoodLabels(
  target: L.Map | L.LayerGroup,
  rows: NeighborhoodRow[],
  selectedKey: string | null,
  viewMode: TerritoryViewMode,
  onSelect: (row: NeighborhoodRow) => void
): L.Layer[] {
  const layers: L.Layer[] = [];

  for (const row of rows) {
    if (row.lat == null || row.lng == null || row.count < 1) continue;

    const selected = selectedKey === row.key;
    const marker = L.marker([row.lat, row.lng], {
      icon: territoryMicroPillIcon({
        label: row.label,
        count: row.count,
        temp: row.dominant,
        viewMode,
        selected,
      }),
      zIndexOffset: selected ? 500 : 120,
    });

    marker.bindTooltip(territoryTooltipHtml(row.label, row.count, row.dominant, tempMixLine(row)), {
      className: 'zm-territory-tip-pane',
      direction: 'top',
      offset: [0, -4],
      opacity: 1,
      sticky: true,
    });

    marker.on('click', () => onSelect(row));
    marker.addTo(target);
    layers.push(marker);
  }

  return layers;
}

const CONTACT_HEAT_GRADIENT: Record<number, string> = {
  0.1: '#3b82f6',
  0.35: '#22d3ee',
  0.55: '#eab308',
  0.75: '#f97316',
  1: '#ef4444',
};

const TEMP_HEAT_WEIGHT: Record<ContactTemperature, number> = {
  hot: 1,
  warm: 0.72,
  cold: 0.45,
  new: 0.22,
};

/** Camada de calor para contatos (densidade + temperatura). */
export function paintContactsHeat(
  target: L.Map | L.LayerGroup,
  pins: MapContactPin[]
): L.Layer[] {
  if (pins.length === 0) return [];

  const points: Array<[number, number, number]> = pins.map((p) => [
    p.lat,
    p.lng,
    TEMP_HEAT_WEIGHT[p.temp] ?? 0.3,
  ]);

  const layer = heatLayerFactory(points, {
    radius: pins.length > 800 ? 22 : pins.length > 300 ? 18 : 14,
    blur: pins.length > 800 ? 20 : 16,
    maxZoom: 17,
    max: 1,
    minOpacity: 0.35,
    gradient: CONTACT_HEAT_GRADIENT,
  });

  layer.addTo(target);
  return [layer];
}

export type NeighborhoodViz = 'heat' | 'bubbles' | 'labels';
export type ContactViz = 'heat' | 'pins';
export type MapTileId = 'voyager' | 'light' | 'dark';

export function paintNeighborhoodLayer(
  target: L.Map | L.LayerGroup,
  mode: NeighborhoodViz,
  rows: NeighborhoodRow[],
  selectedKey: string | null,
  viewMode: TerritoryViewMode,
  onSelect: (row: NeighborhoodRow) => void
): L.Layer[] {
  if (mode === 'heat') return paintNeighborhoodHeat(target, rows, viewMode, onSelect);
  if (mode === 'bubbles') return paintNeighborhoodBubbles(target, rows, selectedKey, viewMode, onSelect);
  return paintNeighborhoodLabels(target, rows, selectedKey, viewMode, onSelect);
}
