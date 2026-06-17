import { apiFetchJson } from '../utils/apiFetchAuth';

export type OperatingLocationSource = 'manual' | 'gps' | 'ip';

export type OperatingLocation = {
  cityLabel: string;
  latitude?: number;
  longitude?: number;
  source?: OperatingLocationSource;
  updatedAt?: string;
};

export async function fetchOperatingLocation(): Promise<OperatingLocation> {
  const j = await apiFetchJson<{ ok: boolean; location: OperatingLocation }>('/api/operating-location');
  return j.location;
}

export async function saveOperatingLocationManual(cityLabel: string): Promise<OperatingLocation> {
  const j = await apiFetchJson<{ ok: boolean; location: OperatingLocation }>('/api/operating-location', {
    method: 'PATCH',
    body: JSON.stringify({ cityLabel, source: 'manual' })
  });
  return j.location;
}

export async function saveOperatingLocationFromGps(
  latitude: number,
  longitude: number
): Promise<OperatingLocation> {
  const j = await apiFetchJson<{ ok: boolean; location: OperatingLocation }>(
    '/api/operating-location/from-gps',
    {
      method: 'POST',
      body: JSON.stringify({ latitude, longitude })
    }
  );
  return j.location;
}

export async function saveOperatingLocationFromIp(): Promise<OperatingLocation> {
  const j = await apiFetchJson<{ ok: boolean; location: OperatingLocation }>(
    '/api/operating-location/from-ip',
    { method: 'POST' }
  );
  return j.location;
}

export { readBrowserGeolocation, requestBrowserGeolocation, queryGeolocationPermission } from '../utils/geolocationHelpers';
