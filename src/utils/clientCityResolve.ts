import {
  knownUfForCity,
  parseGeoFilterCity,
  titleCasePlaceName,
} from './contactAddressNormalize';
import { parseCitySearchQuery } from './ibgeCityLookup';

/** Resolve cidade offline (sem IBGE) — "indaial-sc" → "Indaial · SC". */
export function resolveCityLabelOffline(raw: string): string | null {
  const trimmed = String(raw || '').trim();
  if (trimmed.length < 2) return null;

  const { cityPart, stateHint } = parseCitySearchQuery(trimmed);
  const parsed = parseGeoFilterCity(trimmed);
  const city = titleCasePlaceName(parsed.city || cityPart);
  if (!city || city.length < 2) return null;

  const state = String(parsed.state || stateHint || knownUfForCity(city) || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);

  if (/^[A-Z]{2}$/.test(state)) return `${city} · ${state}`;
  return city.length >= 3 ? city : null;
}
