import type { GeoContactPin } from '../../../services/leadsGeoApi';
import type { Contact } from '../../../types';
import type { ContactTemperature } from '../../../utils/contactTemperature';
import { resolveTrustedContactCoord } from '../../../utils/contactGeoValidate';
import { fixBrazilCoord, isMapCoordValid } from '../../../utils/brazilMapCoords';
import { matchesNeighborhood } from './territoryMapUtils';
import type { MapContactPin } from './types';

export type NeighborhoodContactInput = {
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
  geocodePrecision?: Contact['geocodePrecision'];
};

export function buildContactPinsForNeighborhood(input: {
  contacts: NeighborhoodContactInput[];
  apiPins: GeoContactPin[];
  neighborhoodLabel: string;
  filterCity: string;
  filterState: string;
}): { pins: MapContactPin[]; unmapped: number } {
  const byId = new Map<string, MapContactPin>();
  const nb = input.neighborhoodLabel;

  for (const pin of input.apiPins) {
    const pinNb = pin.neighborhood || '';
    if (pinNb && !matchesNeighborhood(pinNb, nb)) continue;

    const trusted = resolveTrustedContactCoord({
      latitude: pin.lat,
      longitude: pin.lng,
      city: pin.city || input.filterCity,
      state: pin.state || input.filterState,
      zipCode: '',
      street: pin.street,
      number: pin.number,
      geocodePrecision: pin.precision === 'address' ? 'street' : pin.precision === 'city' ? 'city' : 'neighborhood',
    });

    if (!trusted) continue;

    byId.set(pin.id, {
      id: pin.id,
      name: pin.name,
      phone: '',
      neighborhood: pinNb || nb,
      street: pin.street || '',
      number: pin.number || '',
      zipCode: '',
      city: pin.city || input.filterCity,
      state: pin.state || input.filterState,
      temp: 'new',
      lat: trusted.lat,
      lng: trusted.lng,
      approximate: !trusted.verified || pin.approximate === true,
      coordVerified: trusted.verified,
    });
  }

  let unmapped = 0;

  for (const c of input.contacts) {
    if (byId.has(c.id)) {
      const existing = byId.get(c.id)!;
      existing.temp = c.temp;
      existing.phone = c.phone;
      existing.zipCode = c.zipCode;
      existing.name = c.name || existing.name;
      existing.street = c.street || existing.street;
      existing.number = c.number || existing.number;
      continue;
    }

    const trusted = resolveTrustedContactCoord({
      latitude: c.latitude,
      longitude: c.longitude,
      city: c.city || input.filterCity,
      state: c.state || input.filterState,
      zipCode: c.zipCode,
      street: c.street,
      number: c.number,
      geocodePrecision: c.geocodePrecision,
    });

    if (!trusted) {
      unmapped++;
      continue;
    }

    byId.set(c.id, {
      id: c.id,
      name: c.name,
      phone: c.phone,
      neighborhood: c.neighborhood || nb,
      street: c.street || '',
      number: c.number || '',
      zipCode: c.zipCode || '',
      city: c.city || input.filterCity,
      state: c.state || input.filterState,
      temp: c.temp,
      lat: trusted.lat,
      lng: trusted.lng,
      approximate: !trusted.verified,
      coordVerified: trusted.verified,
    });
  }

  return { pins: [...byId.values()], unmapped };
}

/** Pins de todos os contatos do escopo (cidade/UF), com filtro de temperatura. */
export function buildContactPinsForScope(input: {
  contacts: NeighborhoodContactInput[];
  apiPins?: GeoContactPin[];
  filterCity: string;
  filterState: string;
  tempFilter: import('./types').TempFilter;
}): { pins: MapContactPin[]; unmapped: number } {
  const pool =
    input.tempFilter === 'all'
      ? input.contacts
      : input.contacts.filter((c) => c.temp === input.tempFilter);

  const byId = new Map<string, MapContactPin>();

  for (const pin of input.apiPins || []) {
    const trusted = resolveTrustedContactCoord({
      latitude: pin.lat,
      longitude: pin.lng,
      city: pin.city || input.filterCity,
      state: pin.state || input.filterState,
      zipCode: '',
      street: pin.street,
      number: pin.number,
      geocodePrecision:
        pin.precision === 'address' ? 'street' : pin.precision === 'city' ? 'city' : 'neighborhood',
    });
    if (!trusted) continue;

    byId.set(pin.id, {
      id: pin.id,
      name: pin.name,
      phone: '',
      neighborhood: pin.neighborhood || '',
      street: pin.street || '',
      number: pin.number || '',
      zipCode: '',
      city: pin.city || input.filterCity,
      state: pin.state || input.filterState,
      temp: 'new',
      lat: trusted.lat,
      lng: trusted.lng,
      approximate: !trusted.verified || pin.approximate === true,
      coordVerified: trusted.verified,
    });
  }

  let unmapped = 0;

  for (const c of pool) {
    if (byId.has(c.id)) {
      const existing = byId.get(c.id)!;
      existing.temp = c.temp;
      existing.phone = c.phone;
      existing.name = c.name || existing.name;
      existing.neighborhood = c.neighborhood || existing.neighborhood;
      existing.street = c.street || existing.street;
      existing.number = c.number || existing.number;
      existing.zipCode = c.zipCode || existing.zipCode;
      continue;
    }

    const trusted = resolveTrustedContactCoord({
      latitude: c.latitude,
      longitude: c.longitude,
      city: c.city || input.filterCity,
      state: c.state || input.filterState,
      zipCode: c.zipCode,
      street: c.street,
      number: c.number,
      geocodePrecision: c.geocodePrecision,
    });

    if (!trusted) {
      unmapped++;
      continue;
    }

    byId.set(c.id, {
      id: c.id,
      name: c.name,
      phone: c.phone,
      neighborhood: c.neighborhood || '',
      street: c.street || '',
      number: c.number || '',
      zipCode: c.zipCode || '',
      city: c.city || input.filterCity,
      state: c.state || input.filterState,
      temp: c.temp,
      lat: trusted.lat,
      lng: trusted.lng,
      approximate: !trusted.verified,
      coordVerified: trusted.verified,
    });
  }

  return { pins: [...byId.values()], unmapped };
}

/** Limita pins no mapa sem travar o navegador em bases grandes. */
export function capMapContactPins(pins: MapContactPin[], max = 1200): MapContactPin[] {
  if (pins.length <= max) return pins;
  const step = Math.ceil(pins.length / max);
  return pins.filter((_, i) => i % step === 0);
}

/** Valida pin vindo da API antes de plotar. */
export function geoPinToMapPin(pin: GeoContactPin, temp: MapContactPin['temp']): MapContactPin | null {
  const trusted = resolveTrustedContactCoord({
    latitude: pin.lat,
    longitude: pin.lng,
    city: pin.city,
    state: pin.state,
    street: pin.street,
    number: pin.number,
    geocodePrecision: pin.precision === 'address' ? 'street' : pin.precision === 'city' ? 'city' : 'neighborhood',
  });
  if (!trusted) return null;
  const { lat, lng } = fixBrazilCoord(trusted.lat, trusted.lng);
  if (!isMapCoordValid(lat, lng)) return null;
  return {
    id: pin.id,
    name: pin.name,
    phone: '',
    neighborhood: pin.neighborhood,
    street: pin.street || '',
    number: pin.number || '',
    zipCode: '',
    city: pin.city,
    state: pin.state,
    temp,
    lat,
    lng,
    approximate: !trusted.verified,
    coordVerified: trusted.verified,
  };
}
