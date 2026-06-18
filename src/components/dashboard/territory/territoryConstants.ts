import type { ContactTemperature } from '../../../utils/contactTemperature';

export const MAP_TILE_DARK =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
export const MAP_TILE_LIGHT = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const MAP_TILE_POSITRON =
  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
export const MAP_TILE_VOYAGER =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

export const BLUMENAU_CENTER: [number, number] = [-26.9194, -49.0661];
export const BLUMENAU_ZOOM = 12;

/** Paleta viva — temperatura no mapa. */
export const TEMP_COLOR: Record<ContactTemperature, string> = {
  hot: '#FF3B30',
  warm: '#FF9500',
  cold: '#007AFF',
  new: '#8E8E93',
};

export const TEMP_ORDER: Record<ContactTemperature, number> = {
  hot: 0,
  warm: 1,
  cold: 2,
  new: 3,
};

export type TerritoryViewMode = 'temperature' | 'volume';
