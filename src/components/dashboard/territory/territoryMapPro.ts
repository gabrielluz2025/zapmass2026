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

function bubbleSize(count: number, maxCount: number, compact = false): number {
  const t = maxCount > 0 ? Math.min(1, Math.sqrt(count / maxCount)) : 0;
  if (compact) return Math.round(14 + t * 18);
  return Math.round(22 + t * 26);
}

function territoryBubbleIcon(
  row: NeighborhoodRow,
  maxCount: number,
  viewMode: TerritoryViewMode,
  selected: boolean,
  opts?: { compact?: boolean; showCount?: boolean }
): L.DivIcon {
  const compact = opts?.compact ?? false;
  const showCount = opts?.showCount ?? !compact;
  const size = bubbleSize(row.count, maxCount, compact);
  const color = rowColor(row, maxCount, viewMode);
  const countLabel = formatCompactCount(row.count) || String(row.count);
  const selectedCls = selected ? ' zm-territory-bubble--selected' : '';
  const compactCls = compact ? ' zm-territory-bubble--compact' : '';

  return L.divIcon({
    className: 'zm-territory-bubble-wrap',
    html: `<div class="zm-territory-bubble${selectedCls}${compactCls}" style="--bubble-size:${size}px;--bubble-color:${color}" role="button" tabindex="0" title="${escapeHtml(row.label)}">
      <span class="zm-territory-bubble__ring"></span>
      ${showCount ? `<span class="zm-territory-bubble__count">${escapeHtml(countLabel)}</span>` : '<span class="zm-territory-bubble__dot"></span>'}
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2)],
  });
}

function bindNeighborhoodPopup(
  layer: L.Layer,
  row: NeighborhoodRow,
  listEntity: 'city' | 'neighborhood' = 'neighborhood'
): void {
  const mix = tempMixLine(row);
  const html = `<div class="zm-territory-popup">
    <strong>${escapeHtml(row.label)}</strong>
    <p>${row.count.toLocaleString('pt-BR')} contatos</p>
    ${mix ? `<p style="opacity:.75;font-size:11px;margin:4px 0 0">${escapeHtml(mix)}</p>` : ''}
    <p style="opacity:.6;font-size:10px;margin:6px 0 0">${
      listEntity === 'city' ? 'Clique para ver os bairros' : 'Clique para abrir o bairro'
    }</p>
  </div>`;
  layer.bindPopup(html, { className: 'zm-territory-popup', maxWidth: 260 });
}

/** Halos de densidade por bairro — visão analítica. */
export function paintNeighborhoodHeat(
  target: L.Map | L.LayerGroup,
  rows: NeighborhoodRow[],
  viewMode: TerritoryViewMode,
  onSelect: (row: NeighborhoodRow) => void,
  listEntity: 'city' | 'neighborhood' = 'neighborhood'
): L.Layer[] {
  if (rows.length > 28) {
    return paintNeighborhoodDensityHeat(target, rows, viewMode, onSelect, listEntity);
  }

  const layers: L.Layer[] = [];
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const density = rows.length;
  const haloScale = density > 18 ? 0.55 : density > 10 ? 0.72 : 1;
  const opacityScale = density > 18 ? 0.55 : density > 10 ? 0.72 : 1;

  for (const row of rows) {
    if (row.lat == null || row.lng == null || row.count < 1) continue;

    const t = row.count / maxCount;
    const radiusM = Math.round((160 + Math.sqrt(t) * 520) * haloScale);
    const color = rowColor(row, maxCount, viewMode);

    const halo = L.circle([row.lat, row.lng], {
      radius: radiusM,
      fillColor: color,
      fillOpacity: (viewMode === 'volume' ? 0.28 : 0.32) * opacityScale,
      color,
      weight: 1.5,
      opacity: 0.45 * opacityScale,
      className: 'zm-atlas-halo',
    });

    const core = L.circleMarker([row.lat, row.lng], {
      radius: Math.round(4 + Math.sqrt(t) * 8),
      fillColor: color,
      fillOpacity: 1,
      color: '#fff',
      weight: 2,
      opacity: 0.95,
      className: 'zm-atlas-core',
    });

    const tip = territoryTooltipHtml(row.label, row.count, row.dominant, tempMixLine(row));
    core.bindTooltip(tip, {
      className: 'zm-territory-tip-pane',
      direction: 'top',
      offset: [0, -6],
      opacity: 1,
      sticky: false,
    });

    const pick = () => onSelect(row);
    halo.on('click', pick);
    core.on('click', pick);
    bindNeighborhoodPopup(core, row, listEntity);
    halo.addTo(target);
    core.addTo(target);
    layers.push(halo, core);
  }

  return layers;
}

const TERRITORY_HEAT_GRADIENT: Record<number, string> = {
  0.08: '#14b8a6',
  0.28: '#22d3ee',
  0.48: '#eab308',
  0.68: '#f97316',
  1: '#ef4444',
};

/** Camada única de calor — ideal para visão estadual com muitas cidades. */
export function paintNeighborhoodDensityHeat(
  target: L.Map | L.LayerGroup,
  rows: NeighborhoodRow[],
  viewMode: TerritoryViewMode,
  onSelect: (row: NeighborhoodRow) => void,
  listEntity: 'city' | 'neighborhood' = 'neighborhood'
): L.Layer[] {
  const valid = rows.filter((r) => r.lat != null && r.lng != null && r.count > 0);
  if (valid.length === 0) return [];

  const maxCount = Math.max(1, ...valid.map((r) => r.count));
  const points: Array<[number, number, number]> = valid.map((r) => {
    const t = viewMode === 'volume' ? r.count / maxCount : undefined;
    const weight =
      viewMode === 'volume'
        ? 0.25 + Math.min(1, t || 0) * 0.75
        : ({ hot: 1, warm: 0.72, cold: 0.45, new: 0.22 } as const)[r.dominant] ?? 0.3;
    return [r.lat!, r.lng!, weight];
  });

  const layer = heatLayerFactory(points, {
    radius: valid.length > 120 ? 28 : valid.length > 60 ? 24 : 20,
    blur: valid.length > 120 ? 22 : 18,
    maxZoom: 12,
    max: 1,
    minOpacity: 0.28,
    gradient: TERRITORY_HEAT_GRADIENT,
  });
  layer.addTo(target);

  const markers: L.Layer[] = [layer];
  const top = [...valid].sort((a, b) => b.count - a.count).slice(0, Math.min(12, valid.length));

  for (const row of top) {
    const color = rowColor(row, maxCount, viewMode);
    const core = L.circleMarker([row.lat!, row.lng!], {
      radius: row.index === 1 ? 7 : 5,
      fillColor: color,
      fillOpacity: 0.95,
      color: '#fff',
      weight: 2,
      opacity: 1,
      className: 'zm-atlas-core',
    });
    core.bindTooltip(territoryTooltipHtml(row.label, row.count, row.dominant, tempMixLine(row)), {
      className: 'zm-territory-tip-pane',
      direction: 'top',
      offset: [0, -6],
      opacity: 1,
      sticky: false,
    });
    core.on('click', () => onSelect(row));
    bindNeighborhoodPopup(core, row, listEntity);
    core.addTo(target);
    markers.push(core);
  }

  return markers;
}

/** Bolhas numeradas — visão executiva. */
export function paintNeighborhoodBubbles(
  target: L.Map | L.LayerGroup,
  rows: NeighborhoodRow[],
  selectedKey: string | null,
  viewMode: TerritoryViewMode,
  onSelect: (row: NeighborhoodRow) => void,
  listEntity: 'city' | 'neighborhood' = 'neighborhood'
): L.Layer[] {
  const layers: L.Layer[] = [];
  const valid = rows.filter((r) => r.lat != null && r.lng != null && r.count > 0);
  if (valid.length === 0) return layers;

  const compact = valid.length > 24;
  const maxCount = Math.max(1, ...valid.map((r) => r.count));

  for (const row of valid) {
    const selected = selectedKey === row.key;
    const marker = L.marker([row.lat!, row.lng!], {
      icon: territoryBubbleIcon(row, maxCount, viewMode, selected, {
        compact,
        showCount: !compact || row.index <= 8,
      }),
      zIndexOffset: selected ? 400 : 80 + Math.min(120, Math.round(row.count)),
    });

    marker.bindTooltip(territoryTooltipHtml(row.label, row.count, row.dominant, tempMixLine(row)), {
      className: 'zm-territory-tip-pane',
      direction: 'top',
      offset: [0, compact ? -4 : -8],
      opacity: 1,
      sticky: false,
    });

    bindNeighborhoodPopup(marker, row, listEntity);
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
      sticky: false,
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
  onSelect: (row: NeighborhoodRow) => void,
  listEntity: 'city' | 'neighborhood' = 'neighborhood'
): L.Layer[] {
  if (mode === 'heat') return paintNeighborhoodHeat(target, rows, viewMode, onSelect, listEntity);
  if (mode === 'bubbles') return paintNeighborhoodBubbles(target, rows, selectedKey, viewMode, onSelect, listEntity);
  return paintNeighborhoodLabels(target, rows, selectedKey, viewMode, onSelect);
}
