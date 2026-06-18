import type { GeoContactPin } from '../../../services/leadsGeoApi';
import type { Contact } from '../../../types';
import type { ContactTemperature } from '../../../utils/contactTemperature';
import { blumenauSpreadCoord } from '../../../../shared/blumenauNeighborhoods';
import { fixBrazilCoord, isMapCoordValid } from '../../../utils/brazilMapCoords';
import type { MapContactPin } from './types';

/** Espalha contatos sem coordenada ao redor do centro do bairro. */
function jitterAround(lat: number, lng: number, index: number): { lat: number; lng: number } {
  const ring = Math.floor(index / 14) + 1;
  const angle = (index % 14) * ((Math.PI * 2) / 14);
  const scale = 0.0018 * ring;
  return {
    lat: lat + Math.sin(angle) * scale,
    lng: lng + Math.cos(angle) * scale,
  };
}

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
  centerLat: number | null;
  centerLng: number | null;
  neighborhoodLabel: string;
  blumenauIndex?: number;
}): MapContactPin[] {
  const byId = new Map<string, MapContactPin>();
  const nbKey = input.neighborhoodLabel.toLowerCase();

  for (const pin of input.apiPins) {
    const pinNb = (pin.neighborhood || '').toLowerCase();
    if (pinNb && !pinNb.includes(nbKey) && !nbKey.includes(pinNb)) continue;
    const { lat, lng } = fixBrazilCoord(pin.lat, pin.lng);
    if (!isMapCoordValid(lat, lng)) continue;
    byId.set(pin.id, {
      id: pin.id,
      name: pin.name,
      phone: '',
      neighborhood: pin.neighborhood || input.neighborhoodLabel,
      street: pin.street || '',
      number: pin.number || '',
      zipCode: '',
      city: pin.city || '',
      state: pin.state || '',
      temp: 'new',
      lat,
      lng,
      approximate: pin.approximate || pin.precision !== 'address',
    });
  }

  let fallbackIdx = 0;
  let centerLat = input.centerLat;
  let centerLng = input.centerLng;

  if ((centerLat == null || centerLng == null) && input.blumenauIndex != null && input.blumenauIndex >= 0) {
    const spread = blumenauSpreadCoord(input.blumenauIndex);
    centerLat = spread.lat;
    centerLng = spread.lng;
  }

  for (const c of input.contacts) {
    if (byId.has(c.id)) {
      const existing = byId.get(c.id)!;
      existing.temp = c.temp;
      existing.phone = c.phone;
      existing.zipCode = c.zipCode;
      if (c.name) existing.name = c.name;
      continue;
    }

    let lat: number | null = null;
    let lng: number | null = null;
    let approximate = false;

    if (c.latitude != null && c.longitude != null) {
      const fixed = fixBrazilCoord(c.latitude, c.longitude);
      if (isMapCoordValid(fixed.lat, fixed.lng)) {
        lat = fixed.lat;
        lng = fixed.lng;
        approximate = c.geocodePrecision === 'city' || c.geocodePrecision === 'neighborhood';
      }
    }

    if (lat == null && centerLat != null && centerLng != null) {
      const j = jitterAround(centerLat, centerLng, fallbackIdx++);
      lat = j.lat;
      lng = j.lng;
      approximate = true;
    }

    if (lat == null || lng == null) continue;

    byId.set(c.id, {
      id: c.id,
      name: c.name,
      phone: c.phone,
      neighborhood: c.neighborhood || input.neighborhoodLabel,
      street: c.street || '',
      number: c.number || '',
      zipCode: c.zipCode || '',
      city: c.city || '',
      state: c.state || '',
      temp: c.temp,
      lat,
      lng,
      approximate,
    });
  }

  return [...byId.values()];
}
