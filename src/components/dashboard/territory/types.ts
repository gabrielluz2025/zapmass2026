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

export type NeighborhoodContactRow = {
  id: string;
  name: string;
  phone: string;
  neighborhood: string;
  zipCode: string;
  street: string;
  number: string;
  city?: string;
  state?: string;
  temp: ContactTemperature;
  latitude?: number;
  longitude?: number;
  geocodePrecision?: 'street' | 'cep' | 'neighborhood' | 'city';
  lat?: number;
  lng?: number;
  approximate?: boolean;
};

export type MapContactPin = NeighborhoodContactRow & {
  lat: number;
  lng: number;
  approximate: boolean;
  coordVerified?: boolean;
};
