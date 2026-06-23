/** Ajuste leve de posição para evitar sobreposição de marcadores no mapa. */

export type MapPoint = { lat: number; lng: number; key?: string; count?: number };

const MIN_DEG = 0.045;

function distDeg(a: MapPoint, b: MapPoint): number {
  const dLat = a.lat - b.lat;
  const dLng = a.lng - b.lng;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** Empurra marcadores sobrepostos em espiral curta (preserva ordem por contagem). */
export function spreadOverlappingMarkers<T extends MapPoint>(points: T[]): T[] {
  if (points.length < 2) return points;

  const sorted = [...points].sort((a, b) => (b.count || 0) - (a.count || 0));
  const placed: MapPoint[] = [];
  const result: T[] = [];

  for (const pt of sorted) {
    let lat = pt.lat;
    let lng = pt.lng;
    let collides = true;
    let attempt = 0;

    while (collides && attempt < 12) {
      collides = false;
      for (const other of placed) {
        if (distDeg({ lat, lng }, other) < MIN_DEG) {
          collides = true;
          const angle = attempt * 0.9 + (pt.key?.length || 0) * 0.17;
          const r = MIN_DEG * (0.55 + attempt * 0.12);
          const cosLat = Math.cos((lat * Math.PI) / 180);
          lat = pt.lat + r * Math.cos(angle);
          lng = pt.lng + (r * Math.sin(angle)) / (cosLat || 1);
          attempt++;
          break;
        }
      }
      if (!collides) break;
    }

    placed.push({ lat, lng });
    result.push({ ...pt, lat, lng });
  }

  return result;
}
