import type { ContactTemperature } from '../../../utils/contactTemperature';

export type RegionScope = 'city' | 'state';

export type TempFilter = 'all' | ContactTemperature;

export type NeighborhoodRow = {
  key: string;
  label: string;
  count: number;
  hot: number;
  warm: number;
  cold: number;
  new: number;
  lat: number | null;
  lng: number | null;
  dominant: ContactTemperature;
};

export type RegionTempTotals = Record<ContactTemperature, number>;
