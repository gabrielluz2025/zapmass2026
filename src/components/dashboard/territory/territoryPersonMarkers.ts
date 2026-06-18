import L from 'leaflet';
import { CONTACT_TEMP_LABEL } from '../../../utils/contactTemperature';
import { TEMP_COLOR } from './territoryConstants';
import type { MapContactPin } from './types';

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

function personIcon(pin: MapContactPin, selected: boolean, groupSize: number): L.DivIcon {
  const color = TEMP_COLOR[pin.temp];
  const size = selected ? 34 : 28;
  const ring = selected
    ? 'box-shadow:0 0 0 3px #8b5cf6,0 0 0 6px rgba(139,92,246,.35);'
    : pin.coordVerified
      ? 'box-shadow:0 2px 8px rgba(0,0,0,.28);'
      : 'box-shadow:0 0 0 2px #fbbf24,0 2px 6px rgba(0,0,0,.2);';

  const badge =
    groupSize > 1 && !selected
      ? `<span class="zm-atlas-person__badge">${groupSize}</span>`
      : '';

  return L.divIcon({
    className: 'zm-atlas-person-wrap',
    html: `<div class="zm-atlas-person${selected ? ' zm-atlas-person--on' : ''}" style="--pin-color:${color};${ring}">
      ${badge}
      <svg viewBox="0 0 24 32" width="${size}" height="${Math.round(size * 1.15)}" aria-hidden="true">
        <circle cx="12" cy="7.5" r="5.5" fill="currentColor" stroke="#fff" stroke-width="1.8"/>
        <path d="M3.5 32c0-7.5 3.8-12.5 8.5-12.5S20.5 24.5 20.5 32" fill="currentColor" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>
      </svg>
    </div>`,
    iconSize: [size, Math.round(size * 1.15)],
    iconAnchor: [size / 2, Math.round(size * 1.15)],
    popupAnchor: [0, -Math.round(size * 1.1)],
  });
}

function groupHubIcon(count: number): L.DivIcon {
  const size = count >= 10 ? 36 : 32;
  return L.divIcon({
    className: 'zm-atlas-person-wrap',
    html: `<div class="zm-atlas-hub" title="${count} contatos neste endereço">
      <span class="zm-atlas-hub__count">${count}</span>
      <span class="zm-atlas-hub__label">aqui</span>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
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
  const extra = groupSize > 1 ? `<span>Mesmo endereço — clique no círculo roxo</span>` : '';
  return `<div class="zm-atlas-tip zm-atlas-tip--pin">
    <strong>${escapeHtml(pin.name)}</strong>
    <span>${escapeHtml(CONTACT_TEMP_LABEL[pin.temp])}</span>
    ${addr ? `<span>${escapeHtml(addr)}</span>` : ''}
    ${extra}
  </div>`;
}

/** Modo bairro — bonequinhos por contato + hub quando vários no mesmo endereço. */
export function paintContactPins(
  map: L.Map,
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
      const hub = L.marker([pin.lat, pin.lng], {
        icon: groupHubIcon(pin.groupSize),
        zIndexOffset: 100,
      });
      bindGroupPopup(hub, pin.groupPins, onSelect);
      hub.addTo(map);
      layers.push(hub);
    }

    const selected = selectedId === pin.id;
    const marker = L.marker([pin.displayLat, pin.displayLng], {
      icon: personIcon(pin, selected, pin.groupSize),
      zIndexOffset: selected ? 500 : 200,
    });

    marker.bindTooltip(personTooltip(pin, pin.groupSize), {
      className: 'zm-atlas-tip-pane',
      direction: 'top',
      offset: [0, -8],
      opacity: 1,
    });

    marker.on('click', () => onSelect(pin));
    marker.addTo(map);
    layers.push(marker);
  }

  return layers;
}
