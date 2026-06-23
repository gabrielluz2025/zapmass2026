import L from 'leaflet';
import { CONTACT_TEMP_LABEL } from '../../../utils/contactTemperature';
import { TEMP_COLOR } from './territoryConstants';
import type { MapContactPin, NeighborhoodRow } from './types';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type DisplayPin = MapContactPin & {
  displayLat: number;
  displayLng: number;
  groupId: string;
  groupSize: number;
  groupPins: MapContactPin[];
};

const PIN_W = 30;
const PIN_H = 42;

function locationKey(pin: MapContactPin): string {
  const lat = pin.lat.toFixed(5);
  const lng = pin.lng.toFixed(5);
  const addr = `${(pin.street || '').trim()}|${(pin.number || '').trim()}|${(pin.zipCode || '').replace(/\D/g, '')}`;
  return `${lat},${lng}|${addr.toLowerCase()}`;
}

/** Agrupa contatos no mesmo endereço e espalha levemente para cada bonequinho aparecer. */
export function prepareDisplayPins(pins: MapContactPin[]): DisplayPin[] {
  const groups = new Map<string, MapContactPin[]>();
  for (const pin of pins) {
    const key = locationKey(pin);
    const list = groups.get(key) || [];
    list.push(pin);
    groups.set(key, list);
  }

  const out: DisplayPin[] = [];
  for (const group of groups.values()) {
    const centerLat = group[0].lat;
    const centerLng = group[0].lng;
    const gid = locationKey(group[0]);
    const n = group.length;

    if (n === 1) {
      out.push({
        ...group[0],
        displayLat: centerLat,
        displayLng: centerLng,
        groupId: gid,
        groupSize: 1,
        groupPins: group,
      });
      continue;
    }

    const golden = Math.PI * (3 - Math.sqrt(5));
    const cosLat = Math.cos((centerLat * Math.PI) / 180);
    group.forEach((pin, i) => {
      const angle = i * golden;
      const r = 0.000035 + Math.sqrt(i + 1) * 0.000022;
      out.push({
        ...pin,
        displayLat: centerLat + r * Math.cos(angle),
        displayLng: centerLng + (r * Math.sin(angle)) / (cosLat || 1),
        groupId: gid,
        groupSize: n,
        groupPins: group,
      });
    });
  }

  return out;
}

function pinSvg(fill: string, inner: string, w: number, h: number): string {
  return `<svg viewBox="0 0 30 42" width="${w}" height="${h}" aria-hidden="true" class="zm-atlas-pin__svg">
    <path d="M15 0C8.37 0 3 5.37 3 12c0 8.25 12 22 12 22s12-13.75 12-22C27 5.37 21.63 0 15 0z" fill="${fill}" stroke="#fff" stroke-width="2"/>
    ${inner}
  </svg>`;
}

function personPinIcon(pin: MapContactPin, selected: boolean): L.DivIcon {
  const color = TEMP_COLOR[pin.temp];
  const w = selected ? 34 : PIN_W;
  const h = Math.round((w / PIN_W) * PIN_H);
  const ring = selected
    ? 'filter:drop-shadow(0 0 4px #8b5cf6) drop-shadow(0 0 8px rgba(139,92,246,.5));'
    : pin.coordVerified
      ? 'filter:drop-shadow(0 2px 4px rgba(0,0,0,.35));'
      : 'filter:drop-shadow(0 0 2px #fbbf24) drop-shadow(0 2px 4px rgba(0,0,0,.25));';

  const inner = `<circle cx="15" cy="11" r="4.2" fill="#fff"/>
    <circle cx="15" cy="10.5" r="3.2" fill="${color}"/>
    <path d="M9.5 19.5c0-2.8 2.4-4.8 5.5-4.8s5.5 2 5.5 4.8" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`;

  return L.divIcon({
    className: 'zm-atlas-pin-wrap',
    html: `<div class="zm-atlas-pin zm-atlas-pin--person${selected ? ' zm-atlas-pin--on' : ''}" style="${ring}">${pinSvg(color, inner, w, h)}</div>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    popupAnchor: [0, -h + 4],
  });
}

function groupHubPinIcon(count: number): L.DivIcon {
  const w = count >= 10 ? 36 : PIN_W;
  const h = Math.round((w / PIN_W) * PIN_H);
  const inner = `<text x="15" y="14" text-anchor="middle" fill="#fff" font-size="11" font-weight="800" font-family="system-ui,sans-serif">${count}</text>`;

  return L.divIcon({
    className: 'zm-atlas-pin-wrap',
    html: `<div class="zm-atlas-pin zm-atlas-pin--hub" title="${count} contatos neste endereço">${pinSvg('#7c3aed', inner, w, h)}</div>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    popupAnchor: [0, -h + 4],
  });
}

function precisionDot(lat: number, lng: number): L.CircleMarker {
  return L.circleMarker([lat, lng], {
    radius: 3,
    color: '#1e1b4b',
    weight: 2,
    fillColor: '#fff',
    fillOpacity: 1,
    interactive: false,
    className: 'zm-atlas-precision-dot',
  });
}

function groupPopupHtml(pins: MapContactPin[]): string {
  const addr = [pins[0]?.street, pins[0]?.number].filter(Boolean).join(', ');
  const items = pins
    .map(
      (p) => `<button type="button" class="zm-atlas-popup-item" data-contact-id="${escapeHtml(p.id)}">
        <span class="zm-atlas-popup-item__dot" style="background:${TEMP_COLOR[p.temp]}"></span>
        <span class="zm-atlas-popup-item__name">${escapeHtml(p.name)}</span>
        <span class="zm-atlas-popup-item__temp">${escapeHtml(CONTACT_TEMP_LABEL[p.temp])}</span>
      </button>`
    )
    .join('');
  return `<div class="zm-atlas-popup">
    <p class="zm-atlas-popup__title">${pins.length} contatos no mesmo endereço</p>
    ${addr ? `<p class="zm-atlas-popup__addr">${escapeHtml(addr)}</p>` : ''}
    <div class="zm-atlas-popup__list">${items}</div>
  </div>`;
}

function bindGroupPopup(
  marker: L.Marker,
  pins: MapContactPin[],
  onSelect: (pin: MapContactPin) => void
): void {
  marker.bindPopup(groupPopupHtml(pins), { className: 'zm-atlas-popup-pane', maxWidth: 300 });
  marker.on('popupopen', () => {
    const el = marker.getPopup()?.getElement();
    if (!el) return;
    el.querySelectorAll<HTMLButtonElement>('[data-contact-id]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-contact-id');
        const pin = pins.find((p) => p.id === id);
        if (pin) {
          marker.closePopup();
          onSelect(pin);
        }
      };
    });
  });
}

function personTooltip(pin: MapContactPin, groupSize: number): string {
  const addr = [pin.street, pin.number].filter(Boolean).join(', ');
  const extra = groupSize > 1 ? `<span>Mesmo endereço — clique no pin roxo</span>` : '';
  return `<div class="zm-atlas-tip zm-atlas-tip--pin">
    <strong>${escapeHtml(pin.name)}</strong>
    <span>${escapeHtml(CONTACT_TEMP_LABEL[pin.temp])}</span>
    ${addr ? `<span>${escapeHtml(addr)}</span>` : ''}
    ${extra}
  </div>`;
}

/** Modo bairro — pin por contato (ponta no lat/lng) + hub quando vários no mesmo endereço. */
export function paintContactPins(
  target: L.Map | L.LayerGroup,
  pins: MapContactPin[],
  selectedId: string | null,
  onSelect: (pin: MapContactPin) => void
): L.Layer[] {
  const layers: L.Layer[] = [];
  const displayPins = prepareDisplayPins(pins);
  const hubsDone = new Set<string>();

  for (const pin of displayPins) {
    if (pin.groupSize > 1 && !hubsDone.has(pin.groupId)) {
      hubsDone.add(pin.groupId);
      const dot = precisionDot(pin.lat, pin.lng);
      dot.addTo(target);
      layers.push(dot);

      const hub = L.marker([pin.lat, pin.lng], {
        icon: groupHubPinIcon(pin.groupSize),
        zIndexOffset: 100,
      });
      bindGroupPopup(hub, pin.groupPins, onSelect);
      hub.addTo(target);
      layers.push(hub);
    }

    const selected = selectedId === pin.id;
    const atExact = pin.groupSize === 1;
    const lat = atExact ? pin.lat : pin.displayLat;
    const lng = atExact ? pin.lng : pin.displayLng;

    const marker = L.marker([lat, lng], {
      icon: personPinIcon(pin, selected),
      zIndexOffset: selected ? 500 : 200,
    });

    marker.bindTooltip(personTooltip(pin, pin.groupSize), {
      className: 'zm-atlas-tip-pane',
      direction: 'top',
      offset: [0, -PIN_H + 6],
      opacity: 1,
    });

    marker.on('click', () => onSelect(pin));
    marker.addTo(target);
    layers.push(marker);
  }

  return layers;
}

/** Visão geral — um bonequinho por bairro (cor = temperatura dominante). */
export function paintNeighborhoodOverviewPins(
  map: L.Map,
  rows: NeighborhoodRow[],
  selectedKey: string | null,
  onSelect: (row: NeighborhoodRow) => void
): L.Layer[] {
  const layers: L.Layer[] = [];

  for (const row of rows) {
    if (row.lat == null || row.lng == null || row.count < 1) continue;

    const pin: MapContactPin = {
      id: row.key,
      name: row.label,
      phone: '',
      neighborhood: row.label,
      street: '',
      number: '',
      zipCode: '',
      city: '',
      state: '',
      temp: row.dominant,
      lat: row.lat,
      lng: row.lng,
      approximate: true,
      coordVerified: false,
    };

    const selected = selectedKey === row.key;
    const marker = L.marker([row.lat, row.lng], {
      icon: personPinIcon(pin, selected),
      zIndexOffset: selected ? 500 : 100,
    });

    const tip = `<div class="zm-atlas-tip zm-atlas-tip--pin">
      <strong>${escapeHtml(row.label)}</strong>
      <span>${row.count.toLocaleString('pt-BR')} contatos — ${escapeHtml(CONTACT_TEMP_LABEL[row.dominant])}</span>
      <span>Clique para ver cada contato</span>
    </div>`;

    marker.bindTooltip(tip, {
      className: 'zm-atlas-tip-pane',
      direction: 'top',
      offset: [0, -PIN_H + 6],
      opacity: 1,
    });

    marker.on('click', () => onSelect(row));
    marker.addTo(target);
    layers.push(marker);
  }

  return layers;
}
