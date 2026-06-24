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
  return isInsideBrazilBounds(fixed.lat, fixed.lng) && isCoordLikelyOnLand(fixed.lat, fixed.lng);
}

/** Rejeita pontos obviamente no oceano Atlântico (faixas costeiras do Sul/Sudeste). */
export function isCoordLikelyOnLand(lat: number, lng: number): boolean {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;

  // SC — litoral: leste de ~-48.1° no norte é mar
  if (la >= -29.2 && la <= -25.4 && ln > -48.12) return false;
  // PR — litoral norte/centro
  if (la >= -26.5 && la <= -23.2 && ln > -47.85) return false;
  // RJ — baía / oceano a leste
  if (la >= -23.4 && la <= -20.5 && ln > -40.85) return false;
  // ES
  if (la >= -21.5 && la <= -17.5 && ln > -39.35) return false;
  // BA sul
  if (la >= -18.5 && la <= -12.5 && ln > -37.2) return false;

  return true;
}
