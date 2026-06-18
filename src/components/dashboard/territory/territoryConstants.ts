import type { ContactTemperature } from '../../../utils/contactTemperature';

export const MAP_TILE_DARK =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
export const MAP_TILE_LIGHT = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

export const BLUMENAU_CENTER: [number, number] = [-26.9194, -49.0661];
export const BLUMENAU_ZOOM = 12;

/** Paleta premium — temperatura (fosco, sem neon). */
export const TEMP_COLOR: Record<ContactTemperature, string> = {
  hot: '#E85D4C',
  warm: '#D4A017',
  cold: '#5B8DEF',
  new: '#71717A',
};

export const TEMP_ORDER: Record<ContactTemperature, number> = {
  hot: 0,
  warm: 1,
  cold: 2,
  new: 3,
};

export type TerritoryViewMode = 'temperature' | 'volume';
