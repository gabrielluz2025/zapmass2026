import L from 'leaflet';
import { CONTACT_TEMP_LABEL, type ContactTemperature } from '../../../utils/contactTemperature';
import { TEMP_COLOR } from './territoryConstants';
import { formatCompactCount } from './territoryMapUtils';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Micro-pill premium — substitui bolhas vermelhas gigantes. */
export function territoryMicroPillIcon(opts: {
  label: string;
  count: number;
  temp: ContactTemperature;
  viewMode: 'temperature' | 'volume';
  selected: boolean;
}): L.DivIcon {
  const { label, count, temp, viewMode, selected } = opts;
  const dotColor = viewMode === 'volume' ? '#71717A' : TEMP_COLOR[temp];
  const selectedCls = selected ? ' zm-territory-pill--selected' : '';
  const shortLabel = escapeHtml(label.split('·')[0]?.trim() || label);
  const countLabel = formatCompactCount(count) || String(count);

  return L.divIcon({
    className: 'zm-territory-pill-wrap',
    html: `<div class="zm-territory-pill${selectedCls}" role="button" tabindex="0">
      <span class="zm-territory-pill__dot" style="background:${dotColor}"></span>
      <span class="zm-territory-pill__name">${shortLabel}</span>
      <span class="zm-territory-pill__count">${countLabel}</span>
    </div>`,
    iconSize: [1, 1],
    iconAnchor: [0, 16],
  });
}

export function territoryTooltipHtml(
  label: string,
  count: number,
  temp: ContactTemperature,
  tempLine?: string
): string {
  const extra = tempLine ? `<div class="zm-territory-tip__meta">${escapeHtml(tempLine)}</div>` : '';
  return `<div class="zm-territory-tip">
    <div class="zm-territory-tip__title">${escapeHtml(label)}</div>
    <div class="zm-territory-tip__row">
      <span>${count.toLocaleString('pt-BR')} contatos</span>
      <span class="zm-territory-tip__dot" style="background:${TEMP_COLOR[temp]}"></span>
      ${escapeHtml(CONTACT_TEMP_LABEL[temp])}
    </div>
    ${extra}
  </div>`;
}
