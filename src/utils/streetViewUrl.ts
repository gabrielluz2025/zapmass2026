import type { GeoCluster, GeoContactPin } from '../services/leadsGeoApi';

/** Abre Google Street View (Pegman) nas coordenadas do lead. */
export function googleStreetViewUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}

export function googleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function parseClusterLabelParts(cluster: GeoCluster): { nb: string; city: string } {
  let nb = cluster.neighborhood !== '—' ? cluster.neighborhood : '';
  let city = cluster.city !== '—' ? cluster.city : '';
  if (nb && city) return { nb, city };
  const label = cluster.label || '';
  const m = label.match(/^(.+?)\s*[·\-–]\s*(.+)$/);
  if (m) {
    nb = nb || m[1].trim();
    city = city || m[2].trim();
  }
  return { nb, city };
}

/** URL para ver região na rua: coordenadas quando existem, senão busca por endereço. */
export function clusterStreetViewUrl(cluster: GeoCluster): string | null {
  if (cluster.lat != null && cluster.lng != null) {
    return googleStreetViewUrl(cluster.lat, cluster.lng);
  }
  const { nb, city } = parseClusterLabelParts(cluster);
  if (!nb && !city) return null;
  const state = cluster.state !== '—' ? cluster.state : '';
  const query = [nb, city, state, 'Brasil'].filter(Boolean).join(', ');
  return googleMapsSearchUrl(query);
}

export function contactPinStreetViewUrl(pin: GeoContactPin): string {
  if (Number.isFinite(pin.lat) && Number.isFinite(pin.lng)) {
    return googleStreetViewUrl(pin.lat, pin.lng);
  }
  const parts = [pin.street, pin.number, pin.neighborhood, pin.city, pin.state, 'Brasil'].filter(Boolean);
  return googleMapsSearchUrl(parts.join(', '));
}
