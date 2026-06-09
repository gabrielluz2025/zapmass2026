/** Validação leve de coordenadas no mapa (cliente). */

export function fixBrazilCoord(lat: number, lng: number): { lat: number; lng: number } {
  let la = Number(lat);
  let ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return { lat: la, lng: ln };
  if (ln > 0 && ln <= 75) ln = -ln;
  if (la > 0 && la <= 35) la = -la;
  if (la >= -75 && la <= -32 && ln >= -35 && ln <= 5) {
    const tmp = la;
    la = ln;
    ln = tmp;
    if (ln > 0 && ln <= 75) ln = -ln;
    if (la > 0 && la <= 35) la = -la;
  }
  return { lat: la, lng: ln };
}

export function isInsideBrazilBounds(lat: number, lng: number): boolean {
  return lat >= -35 && lat <= 6 && lng >= -75 && lng <= -32;
}

export function isMapCoordValid(
  lat: number,
  lng: number,
  _city?: string,
  _state?: string
): boolean {
  const fixed = fixBrazilCoord(lat, lng);
  return isInsideBrazilBounds(fixed.lat, fixed.lng);
}
