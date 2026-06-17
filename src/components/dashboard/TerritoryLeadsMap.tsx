/**
 * Mapa territorial de leads — OpenStreetMap (gratuito) + CEP/endereço cadastrado.
 * Foco por cidade (padrão Blumenau), agregação por bairro, heatmap e temperatura quente/morno/frio.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import {
  ChevronLeft,
  Crosshair,
  Download,
  Flame,
  Loader2,
  MapPin,
  RefreshCw,
  Snowflake,
  Sun,
  Thermometer,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { Contact, Conversation } from '../../types';
import {
  fetchLeadsGeoSummary,
  apiGeocodeContacts,
  type GeoCluster,
  type LeadsGeoSummary,
} from '../../services/leadsGeoApi';
import { useOperatingLocation } from '../../hooks/useOperatingLocation';
import {
  computeContactTemperatures,
  CONTACT_TEMP_LABEL,
  type ContactTemperature,
} from '../../utils/contactTemperature';
import { fixBrazilCoord, isMapCoordValid } from '../../utils/brazilMapCoords';
import { exportLeadsGeoXlsx } from '../../utils/exportLeadsGeoXlsx';
import { Button } from '../ui/Button';
import {
  BLUMENAU_OFFICIAL_NEIGHBORHOODS,
  blumenauSpreadCoord,
  isBlumenauCity,
  matchOfficialNeighborhood,
  normBlumenauNbKey
} from '../../../shared/blumenauNeighborhoods';

const BLUMENAU_CENTER: L.LatLngExpression = [-26.9194, -49.0661];
const BLUMENAU_ZOOM = 12;

const MAP_TILE_DARK =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const MAP_TILE_LIGHT = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

const HEAT_GRADIENT_PRO: Record<number, string> = {
  0.0: '#1e1b4b',
  0.25: '#4338ca',
  0.45: '#6366f1',
  0.6: '#a855f7',
  0.75: '#f97316',
  1.0: '#ef4444'
};

const TEMP_COLOR: Record<ContactTemperature, string> = {
  hot: '#ef4444',
  warm: '#f59e0b',
  cold: '#38bdf8',
  new: '#94a3b8',
};

const TEMP_ORDER: Record<ContactTemperature, number> = {
  hot: 0,
  warm: 1,
  cold: 2,
  new: 3,
};

type HeatMapOptions = {
  radius?: number;
  blur?: number;
  maxZoom?: number;
  max?: number;
  minOpacity?: number;
  gradient?: Record<number, string>;
};
type HeatLayerInstance = L.Layer;
const heatLayer = (
  L as unknown as {
    heatLayer: (latlngs: Array<[number, number, number?]>, options?: HeatMapOptions) => HeatLayerInstance;
  }
).heatLayer;

type ViewMode = 'circles' | 'heatmap' | 'temperature';

type NeighborhoodContactRow = {
  id: string;
  name: string;
  phone: string;
  neighborhood: string;
  zipCode: string;
  street: string;
  number: string;
  temp: ContactTemperature;
};

function formatCompactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return n > 0 ? String(n) : '';
}

function territoryBubbleIcon(
  count: number,
  color: string,
  maxCount: number,
  selected: boolean
): L.DivIcon {
  const t = count / Math.max(1, maxCount);
  const size = Math.round(34 + Math.sqrt(t) * 30);
  const label = formatCompactCount(count);
  const selectedCls = selected ? ' zm-territory-bubble--selected' : '';
  return L.divIcon({
    className: 'zm-territory-bubble-wrap',
    html: `<div class="zm-territory-bubble${selectedCls}" style="--bubble-size:${size}px;--bubble-color:${color}"><span class="zm-territory-bubble__count">${label}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

function territoryPopupHtml(label: string, count: number, tempLine: string): string {
  return `<strong>${label}</strong><br/><span style="opacity:0.85">${count.toLocaleString('pt-BR')} contatos</span>${tempLine}<br/><span style="font-size:11px;color:#a5b4fc">Clique para explorar</span>`;
}

function tempIcon(color: string, size = 12): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<span style="
      display:block;width:${size}px;height:${size}px;border-radius:50%;
      background:${color};border:2px solid #fff;
      box-shadow:0 0 0 1px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.35);
    "></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function normalizeKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchesNeighborhood(contactNb: string, selected: string): boolean {
  const a = normalizeKey(contactNb);
  const b = normalizeKey(selected);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function matchesCity(contactCity: string, filterCity: string): boolean {
  const base = normalizeKey(filterCity.split('·')[0] || filterCity);
  const c = normalizeKey(contactCity);
  if (!base) return true;
  if (!c) return true;
  const baseToken = base.split(' ')[0] || base;
  return c.includes(baseToken) || base.includes(c.split(' ')[0] || c);
}

type NbTempStats = {
  label: string;
  hot: number;
  warm: number;
  cold: number;
  new: number;
  total: number;
};

function dominantNeighborhoodTemp(stats: NbTempStats): ContactTemperature {
  const ranked: [ContactTemperature, number][] = [
    ['hot', stats.hot],
    ['warm', stats.warm],
    ['cold', stats.cold],
    ['new', stats.new]
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  return ranked[0][1] > 0 ? ranked[0][0] : 'new';
}

function buildBlumenauNbStats(
  contacts: Contact[],
  city: string,
  tempsByContact: Record<string, { temp: ContactTemperature }>
): Map<string, NbTempStats> {
  const map = new Map<string, NbTempStats>();
  for (const name of BLUMENAU_OFFICIAL_NEIGHBORHOODS) {
    map.set(normBlumenauNbKey(name), {
      label: name,
      hot: 0,
      warm: 0,
      cold: 0,
      new: 0,
      total: 0
    });
  }
  for (const c of contacts) {
    if (!matchesCity(c.city || '', city)) continue;
    const official = matchOfficialNeighborhood(c.neighborhood || '');
    if (!official) continue;
    const slot = map.get(normBlumenauNbKey(official));
    if (!slot) continue;
    const t = tempsByContact[c.id]?.temp || 'new';
    slot[t]++;
    slot.total++;
  }
  return map;
}

function buildLocalBlumenauSummary(
  blumenauNbStats: Map<string, NbTempStats>,
  totalContacts: number
): LeadsGeoSummary {
  const clusters: GeoCluster[] = BLUMENAU_OFFICIAL_NEIGHBORHOODS.map((name, idx) => {
    const { lat, lng } = blumenauSpreadCoord(idx);
    const stats = blumenauNbStats.get(normBlumenauNbKey(name));
    return {
      key: `blumenau-${normBlumenauNbKey(name)}`,
      label: name,
      city: 'Blumenau',
      state: 'SC',
      neighborhood: name,
      ddd: '47',
      count: stats?.total ?? 0,
      lat,
      lng,
      precision: 'neighborhood',
      mapped: false,
      sampleNames: []
    };
  });
  const filteredTotal = [...blumenauNbStats.values()].reduce((acc, s) => acc + s.total, 0);
  return {
    stats: {
      totalContacts,
      withAnyAddress: filteredTotal,
      withCity: filteredTotal,
      withNeighborhood: filteredTotal,
      withPhone: 0,
      clusters: clusters.length,
      clustersMapped: 0,
      clustersPending: clusters.length,
      filteredTotal
    },
    layer: 'neighborhood',
    clusters,
    byState: { SC: filteredTotal },
    byDdd: { '47': filteredTotal },
    byCity: { 'Blumenau · SC': filteredTotal },
    byNeighborhood: Object.fromEntries(clusters.map((c) => [c.label, c.count])),
    filters: {
      cities: ['Blumenau · SC'],
      states: ['SC'],
      ddds: ['47'],
      neighborhoods: [...BLUMENAU_OFFICIAL_NEIGHBORHOODS]
    },
    topConcentration: null,
    contactPins: [],
    pinStats: { withFullAddress: 0, pinsMapped: 0, pinsApproximate: 0, pinsPending: 0 },
    mapViewport: { lat: -26.9194, lng: -49.0661, zoom: BLUMENAU_ZOOM }
  };
}

function slugFile(s: string): string {
  return normalizeKey(s).replace(/\s+/g, '_').slice(0, 40) || 'bairro';
}

function downloadNeighborhoodCsv(rows: NeighborhoodContactRow[], city: string, neighborhood: string): void {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [
    ['Nome', 'Telefone', 'Bairro', 'CEP', 'Rua', 'Número', 'Temperatura'].join(';'),
    ...rows.map((r) =>
      [
        esc(r.name),
        esc(r.phone),
        esc(r.neighborhood || neighborhood),
        esc(r.zipCode),
        esc(r.street),
        esc(r.number),
        esc(CONTACT_TEMP_LABEL[r.temp]),
      ].join(';')
    ),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `contatos_${slugFile(neighborhood)}_${slugFile(city.split('·')[0] || city)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

type Props = {
  contacts: Contact[];
  conversations: Conversation[];
  /** Ex.: "Blumenau · SC" */
  defaultCity?: string;
  compact?: boolean;
  /** Só carrega geo/API quando o mapa entra no viewport (performance). */
  deferLoad?: boolean;
};

export const TerritoryLeadsMap: React.FC<Props> = ({
  contacts,
  conversations,
  defaultCity = 'Blumenau · SC',
  compact = false,
  deferLoad = false,
}) => {
  const {
    cityLabel: city,
    setCityLabel: setCity,
    gpsLoading,
    loading: locationLoading,
    useMyLocation,
    cityPresets
  } = useOperatingLocation(defaultCity);
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<L.Layer[]>([]);
  const lastGeoErrorToastRef = useRef(0);
  const lastFlyKeyRef = useRef('');

  const [summary, setSummary] = useState<LeadsGeoSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiSyncing, setApiSyncing] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('heatmap');
  const [selectedNb, setSelectedNb] = useState<string | null>(null);
  const [mapActive, setMapActive] = useState(!deferLoad);

  const blumenauFocus = isBlumenauCity(city);

  const tempsByContact = useMemo(
    () => computeContactTemperatures(contacts, conversations),
    [contacts, conversations]
  );

  const blumenauNbStats = useMemo(() => {
    if (!blumenauFocus) return null;
    return buildBlumenauNbStats(contacts, city, tempsByContact);
  }, [blumenauFocus, contacts, city, tempsByContact]);

  const localBlumenauSummary = useMemo(() => {
    if (!blumenauFocus || !blumenauNbStats) return null;
    return buildLocalBlumenauSummary(blumenauNbStats, contacts.length);
  }, [blumenauFocus, blumenauNbStats, contacts.length]);

  const mapSummary = summary ?? localBlumenauSummary;

  const topNeighborhoods = useMemo(() => {
    if (blumenauFocus && blumenauNbStats) {
      return BLUMENAU_OFFICIAL_NEIGHBORHOODS.map((name) => {
        const stats = blumenauNbStats.get(normBlumenauNbKey(name));
        return { label: name, count: stats?.total ?? 0 };
      }).sort((a, b) => b.count - a.count);
    }
    const entries = Object.entries(summary?.byNeighborhood || {});
    return entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, compact ? 8 : 12)
      .map(([label, count]) => ({ label, count }));
  }, [blumenauFocus, blumenauNbStats, summary?.byNeighborhood, compact]);

  const neighborhoodContacts = useMemo((): NeighborhoodContactRow[] => {
    if (!selectedNb) return [];
    return contacts
      .filter((c) => {
        if (!matchesCity(c.city || '', city)) return false;
        if (blumenauFocus) {
          const official = matchOfficialNeighborhood(c.neighborhood || '');
          return official === selectedNb || matchesNeighborhood(c.neighborhood || '', selectedNb);
        }
        return matchesNeighborhood(c.neighborhood || '', selectedNb);
      })
      .map((c) => ({
        id: c.id,
        name: c.name || 'Sem nome',
        phone: c.phone || '',
        neighborhood: c.neighborhood || selectedNb,
        zipCode: c.zipCode || '',
        street: c.street || '',
        number: c.number || '',
        temp: tempsByContact[c.id]?.temp || 'new',
      }))
      .sort((a, b) => {
        const td = TEMP_ORDER[a.temp] - TEMP_ORDER[b.temp];
        if (td !== 0) return td;
        return a.name.localeCompare(b.name, 'pt-BR');
      });
  }, [selectedNb, contacts, city, tempsByContact, blumenauFocus]);

  const nbTempBreakdown = useMemo(() => {
    const counts = { hot: 0, warm: 0, cold: 0, new: 0 };
    for (const row of neighborhoodContacts) counts[row.temp]++;
    return counts;
  }, [neighborhoodContacts]);

  const tempCounts = useMemo(() => {
    if (blumenauFocus && blumenauNbStats) {
      const counts = { hot: 0, warm: 0, cold: 0, new: 0 };
      for (const stats of blumenauNbStats.values()) {
        if (stats.total === 0) {
          counts.new++;
          continue;
        }
        counts[dominantNeighborhoodTemp(stats)]++;
      }
      return counts;
    }
    const pins = summary?.contactPins || [];
    const counts = { hot: 0, warm: 0, cold: 0, new: 0 };
    for (const pin of pins.slice(0, 400)) {
      const t = tempsByContact[pin.id]?.temp || 'new';
      counts[t]++;
    }
    return counts;
  }, [blumenauFocus, blumenauNbStats, summary?.contactPins, tempsByContact]);

  const selectNeighborhood = useCallback((nb: string) => {
    setSelectedNb(nb.split('·')[0]?.trim() || nb);
  }, []);

  useEffect(() => {
    if (!mapActive || !containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: BLUMENAU_CENTER,
      zoom: BLUMENAU_ZOOM,
      zoomControl: !compact,
    });
    L.tileLayer(compact ? MAP_TILE_LIGHT : MAP_TILE_DARK, {
      attribution: compact ? '© OpenStreetMap' : '© OpenStreetMap © CARTO',
      subdomains: compact ? 'abc' : 'abcd',
      maxZoom: 20,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [compact, mapActive]);

  const loadSummary = useCallback(async () => {
    const hasLocalFallback = !!(blumenauFocus && localBlumenauSummary);
    if (!hasLocalFallback) setLoading(true);
    else setApiSyncing(true);
    try {
      const data = await fetchLeadsGeoSummary({
        layer: 'neighborhood',
        city,
        neighborhood: selectedNb || undefined,
        light: true
      });
      setSummary(data);
    } catch (e) {
      if (hasLocalFallback) return;
      const msg = e instanceof Error ? e.message : 'Erro ao carregar mapa.';
      const now = Date.now();
      if (now - lastGeoErrorToastRef.current > 12_000) {
        lastGeoErrorToastRef.current = now;
        toast.error(msg);
      }
    } finally {
      setLoading(false);
      setApiSyncing(false);
    }
  }, [city, selectedNb, blumenauFocus, localBlumenauSummary]);

  useEffect(() => {
    if (!deferLoad || mapActive || !rootRef.current) return;
    const el = rootRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMapActive(true);
          obs.disconnect();
        }
      },
      { rootMargin: '120px', threshold: 0.05 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [deferLoad, mapActive]);

  useEffect(() => {
    if (!mapActive) return;
    void loadSummary();
  }, [loadSummary, mapActive]);

  const paintMap = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapSummary) return;

    for (const layer of layersRef.current) {
      map.removeLayer(layer);
    }
    layersRef.current = [];

    const clusters = mapSummary.clusters.filter((c) => c.lat != null && c.lng != null);
    const maxCount = Math.max(1, ...clusters.map((c) => c.count));

    const clusterTempLine = (cluster: (typeof clusters)[0]) => {
      const nbStats = blumenauNbStats?.get(normBlumenauNbKey(cluster.label));
      return nbStats && nbStats.total > 0
        ? `<br/>${CONTACT_TEMP_LABEL[dominantNeighborhoodTemp(nbStats)]} · ${nbStats.hot}Q ${nbStats.warm}M ${nbStats.cold}F`
        : '';
    };

    const addTerritoryMarker = (
      cluster: (typeof clusters)[0],
      lat: number,
      lng: number,
      count: number,
      color: string
    ) => {
      if (count < 1 && blumenauFocus) return;
      const nbKey = normBlumenauNbKey(cluster.label.split('·')[0]?.trim() || cluster.label);
      const isSelected = selectedNb ? normBlumenauNbKey(selectedNb) === nbKey : false;
      const marker = L.marker([lat, lng], {
        icon: territoryBubbleIcon(count, color, maxCount, isSelected),
        zIndexOffset: isSelected ? 1000 : Math.round(count)
      });
      marker.bindPopup(territoryPopupHtml(cluster.label, count, clusterTempLine(cluster)), {
        className: 'zm-territory-popup'
      });
      marker.on('click', () => selectNeighborhood(cluster.label));
      marker.addTo(map);
      layersRef.current.push(marker);
    };

    const paintHeatUnderlay = () => {
      const points: [number, number, number][] = [];
      for (const cluster of clusters) {
        const { lat, lng } = fixBrazilCoord(cluster.lat!, cluster.lng!);
        if (!isMapCoordValid(lat, lng) || cluster.count < 1) continue;
        const nbStats = blumenauNbStats?.get(normBlumenauNbKey(cluster.label));
        const temp = nbStats && nbStats.total > 0 ? dominantNeighborhoodTemp(nbStats) : 'new';
        const tempBoost =
          temp === 'hot' ? 1 : temp === 'warm' ? 0.78 : temp === 'cold' ? 0.55 : 0.35;
        const weight = (0.2 + (cluster.count / maxCount) * 0.8) * tempBoost;
        points.push([lat, lng, weight]);
      }
      if (points.length === 0) return;
      const hl = heatLayer(points, {
        radius: compact ? 32 : 42,
        blur: compact ? 22 : 28,
        maxZoom: 14,
        minOpacity: compact ? 0.35 : 0.45,
        gradient: HEAT_GRADIENT_PRO
      });
      hl.addTo(map);
      layersRef.current.push(hl);
    };

    if (viewMode === 'heatmap' || (viewMode === 'temperature' && !compact)) {
      paintHeatUnderlay();
    }

    if (viewMode === 'circles') {
      for (const cluster of clusters) {
        const { lat, lng } = fixBrazilCoord(cluster.lat!, cluster.lng!);
        if (!isMapCoordValid(lat, lng)) continue;
        addTerritoryMarker(cluster, lat, lng, cluster.count, '#6366f1');
      }
    } else if (viewMode === 'heatmap') {
      for (const cluster of clusters) {
        const { lat, lng } = fixBrazilCoord(cluster.lat!, cluster.lng!);
        if (!isMapCoordValid(lat, lng) || cluster.count < 1) continue;
        const nbStats = blumenauNbStats?.get(normBlumenauNbKey(cluster.label));
        const temp = nbStats && nbStats.total > 0 ? dominantNeighborhoodTemp(nbStats) : 'hot';
        addTerritoryMarker(cluster, lat, lng, cluster.count, TEMP_COLOR[temp]);
      }
    } else {
      for (const cluster of clusters) {
        const { lat, lng } = fixBrazilCoord(cluster.lat!, cluster.lng!);
        if (!isMapCoordValid(lat, lng)) continue;
        const nbStats = blumenauNbStats?.get(normBlumenauNbKey(cluster.label));
        const count = nbStats?.total ?? cluster.count;
        const temp =
          nbStats && nbStats.total > 0 ? dominantNeighborhoodTemp(nbStats) : count > 0 ? 'new' : 'new';
        addTerritoryMarker(cluster, lat, lng, count, TEMP_COLOR[temp]);
      }

      if (!blumenauFocus) {
        const pins = mapSummary.contactPins.slice(0, compact ? 120 : 200);
        for (const pin of pins) {
          const { lat, lng } = fixBrazilCoord(pin.lat, pin.lng);
          if (!isMapCoordValid(lat, lng)) continue;
          const temp = tempsByContact[pin.id]?.temp || 'new';
          const marker = L.marker([lat, lng], {
            icon: tempIcon(TEMP_COLOR[temp], 10)
          });
          marker.bindPopup(`<strong>${pin.name}</strong><br/>${CONTACT_TEMP_LABEL[temp]}`, {
            className: 'zm-territory-popup'
          });
          marker.addTo(map);
          layersRef.current.push(marker);
        }
      }
    }

    const vp = mapSummary.mapViewport;
    const flyKey = `${city}|${vp?.lat ?? ''}|${vp?.lng ?? ''}|${vp?.zoom ?? ''}`;
    if (flyKey !== lastFlyKeyRef.current) {
      lastFlyKeyRef.current = flyKey;
      if (vp) {
        map.flyTo([vp.lat, vp.lng], vp.zoom, { duration: 0.8 });
      } else if (blumenauFocus) {
        map.flyTo(BLUMENAU_CENTER, BLUMENAU_ZOOM, { duration: 0.6 });
      }
    }
  }, [
    mapSummary,
    viewMode,
    tempsByContact,
    city,
    compact,
    selectNeighborhood,
    blumenauNbStats,
    blumenauFocus,
    selectedNb
  ]);

  useEffect(() => {
    paintMap();
  }, [paintMap]);

  const handleGeocode = async () => {
    setGeocoding(true);
    try {
      const r = await apiGeocodeContacts({ max: 80, city, force: false });
      setSummary(r.summary);
      toast.success(`${r.geocoded} endereço(s) mapeado(s) via CEP/OpenStreetMap.`);
    } catch {
      toast.error('Falha ao geocodificar endereços.');
    } finally {
      setGeocoding(false);
    }
  };

  const handleExportXlsx = () => {
    if (!summary || !selectedNb) return;
    try {
      const n = exportLeadsGeoXlsx(summary, {
        layer: 'neighborhood',
        query: { layer: 'neighborhood', city, neighborhood: selectedNb },
      });
      toast.success(`Excel exportado (${n} regiões).`);
    } catch {
      toast.error('Falha ao exportar Excel.');
    }
  };

  const handleExportCsv = () => {
    if (!selectedNb || neighborhoodContacts.length === 0) {
      toast.error('Nenhum contato neste bairro para exportar.');
      return;
    }
    downloadNeighborhoodCsv(neighborhoodContacts, city, selectedNb);
    toast.success(`${neighborhoodContacts.length} contato(s) exportado(s) em CSV.`);
  };

  const cityOptions = useMemo(() => {
    const fromApi = summary?.filters.cities || [];
    const set = new Set<string>([...cityPresets, ...fromApi]);
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [summary?.filters.cities, cityPresets]);

  const viewModes: { id: ViewMode; label: string }[] = [
    { id: 'temperature', label: 'Temperatura' },
    { id: 'circles', label: 'Volume' },
    { id: 'heatmap', label: 'Calor' }
  ];

  const listPreview = neighborhoodContacts.slice(0, compact ? 40 : 80);
  const proUi = !compact;
  const regionLeadCount = useMemo(() => {
    if (blumenauFocus && blumenauNbStats) {
      return [...blumenauNbStats.values()].reduce((acc, s) => acc + s.total, 0);
    }
    return mapSummary?.stats.filteredTotal ?? 0;
  }, [blumenauFocus, blumenauNbStats, mapSummary?.stats.filteredTotal]);

  return (
    <div
      ref={rootRef}
      className={`zm-territory-map flex flex-col ${proUi ? 'zm-territory-map--pro' : ''} ${compact ? 'h-[320px]' : 'h-[min(58vh,560px)]'}`}
    >
      <div className={proUi ? 'zm-territory-map__toolbar' : 'flex flex-wrap items-center gap-2 mb-3'}>
        <div className={`flex items-center gap-2 flex-1 min-w-[200px] ${proUi ? 'relative' : ''}`}>
          <MapPin
            className={`w-4 h-4 shrink-0 ${proUi ? 'absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400' : 'text-indigo-500'}`}
          />
          <input
            list="zm-city-presets"
            value={city}
            disabled={locationLoading}
            onChange={(e) => {
              setSelectedNb(null);
              setCity(e.target.value);
            }}
            className={
              proUi
                ? 'zm-territory-map__city-input w-full pl-9'
                : 'flex-1 min-w-0 rounded-xl border border-stone-200/80 bg-white/90 px-3 py-2 text-[13px] font-semibold text-stone-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/50 disabled:opacity-60'
            }
            placeholder="Cidade · UF (ex: Blumenau · SC)"
          />
          <datalist id="zm-city-presets">
            {cityOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <Button
          variant="ghost"
          size="sm"
          disabled={locationLoading || gpsLoading}
          onClick={() => {
            setSelectedNb(null);
            void useMyLocation();
          }}
          title="Detectar minha localização automaticamente"
          leftIcon={
            gpsLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Crosshair className="w-3.5 h-3.5" />
            )
          }
        >
          GPS
        </Button>

        <div className={proUi ? 'zm-territory-map__mode-toggle' : 'flex gap-1 p-0.5 rounded-xl bg-stone-100 border border-stone-200/80'}>
          {viewModes.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setViewMode(m.id)}
              className={
                proUi
                  ? `zm-territory-map__mode-btn${viewMode === m.id ? ' zm-territory-map__mode-btn--active' : ''}`
                  : `px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                      viewMode === m.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-stone-500'
                    }`
              }
            >
              {m.label}
            </button>
          ))}
        </div>

        <Button
          variant="ghost"
          size="sm"
          leftIcon={
            geocoding ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )
          }
          disabled={geocoding || loading}
          onClick={() => void handleGeocode()}
        >
          Mapear CEP
        </Button>

        {selectedNb && (
          <button
            type="button"
            onClick={() => setSelectedNb(null)}
            className="text-[11px] font-bold text-indigo-600 hover:underline"
          >
            Limpar bairro: {selectedNb}
          </button>
        )}
      </div>

      <div className="flex flex-1 min-h-0 gap-3">
        <div
          className={
            proUi
              ? 'zm-territory-map__frame relative flex-1 min-w-0'
              : 'relative flex-1 min-w-0 rounded-2xl overflow-hidden border border-stone-200/90 shadow-inner bg-stone-100'
          }
        >
          <div ref={containerRef} className="absolute inset-0 z-0" />
          {loading && !mapSummary && (
            <div
              className={`absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm ${proUi ? 'bg-slate-950/70' : 'bg-white/60'}`}
            >
              <Loader2 className={`w-8 h-8 animate-spin ${proUi ? 'text-indigo-400' : 'text-indigo-600'}`} />
            </div>
          )}
          {apiSyncing && mapSummary && !summary && (
            <div className={proUi ? 'zm-territory-map__sync-badge' : 'absolute top-3 right-3 z-[500] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-white/95 border border-stone-200 shadow-sm text-stone-600'}>
              <Loader2 className="w-3 h-3 animate-spin text-indigo-500" />
              Sincronizando mapa…
            </div>
          )}
          {!mapActive && deferLoad && (
            <div
              className={`absolute inset-0 z-10 flex items-center justify-center text-[12px] font-semibold ${proUi ? 'bg-slate-950/85 text-slate-400' : 'bg-stone-50/90 text-stone-500'}`}
            >
              Mapa carrega ao rolar até aqui…
            </div>
          )}

          <div className={proUi ? 'zm-territory-map__legend' : 'absolute bottom-3 left-3 z-[500] flex flex-wrap gap-2'}>
            {viewMode === 'temperature' ? (
              (['hot', 'warm', 'cold', 'new'] as ContactTemperature[]).map((t) => (
                <span
                  key={t}
                  className={
                    proUi
                      ? 'zm-territory-map__legend-chip'
                      : 'inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold bg-white/95 border border-stone-200 shadow-sm'
                  }
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: TEMP_COLOR[t] }} />
                  {CONTACT_TEMP_LABEL[t]} ({tempCounts[t]})
                </span>
              ))
            ) : viewMode === 'heatmap' ? (
              <span className={proUi ? 'zm-territory-map__legend-chip' : 'inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold bg-white/95 border border-stone-200 shadow-sm text-stone-600'}>
                <span className="w-10 h-2 rounded-full bg-gradient-to-r from-indigo-900 via-violet-500 to-orange-500" />
                Densidade territorial
              </span>
            ) : (
              <span className={proUi ? 'zm-territory-map__legend-chip' : 'inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold bg-white/95 border border-stone-200 shadow-sm text-stone-600'}>
                <span className="w-3 h-3 rounded-full bg-indigo-500/80 border border-indigo-300" />
                Volume por região
              </span>
            )}
          </div>
        </div>

        {!compact && (
          <aside className="zm-territory-map__rank hidden lg:flex">
            {selectedNb ? (
              <>
                <div className="p-3 border-b border-stone-100 bg-indigo-50/60">
                  <button
                    type="button"
                    onClick={() => setSelectedNb(null)}
                    className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:underline mb-2"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Voltar ao ranking
                  </button>
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-stone-400">
                    Contatos · {selectedNb}
                  </p>
                  <p className="text-[18px] font-black text-stone-900 tabular-nums mt-0.5">
                    {neighborhoodContacts.length.toLocaleString('pt-BR')}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(['hot', 'warm', 'cold', 'new'] as ContactTemperature[]).map((t) =>
                      nbTempBreakdown[t] > 0 ? (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-white border border-stone-200"
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: TEMP_COLOR[t] }} />
                          {nbTempBreakdown[t]}
                        </span>
                      ) : null
                    )}
                  </div>
                  <div className="flex gap-1.5 mt-3">
                    <button
                      type="button"
                      onClick={handleExportCsv}
                      className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold text-stone-700 bg-white border border-stone-200 hover:bg-stone-50"
                    >
                      <Download className="w-3 h-3" />
                      CSV
                    </button>
                    <button
                      type="button"
                      onClick={handleExportXlsx}
                      disabled={!summary}
                      className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50"
                    >
                      <Download className="w-3 h-3" />
                      Excel
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {neighborhoodContacts.length === 0 ? (
                    <p className="text-[11px] text-stone-500 p-2 leading-relaxed">
                      Nenhum contato com bairro &quot;{selectedNb}&quot; cadastrado. Confira CEP/endereço nos
                      contatos.
                    </p>
                  ) : (
                    <>
                      {listPreview.map((row) => (
                        <div
                          key={row.id}
                          className="rounded-xl border border-stone-100 bg-stone-50/80 px-2.5 py-2 hover:border-indigo-200 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-[11px] font-bold text-stone-800 truncate">{row.name}</p>
                            <span
                              className="shrink-0 w-2 h-2 rounded-full mt-1"
                              style={{ background: TEMP_COLOR[row.temp] }}
                              title={CONTACT_TEMP_LABEL[row.temp]}
                            />
                          </div>
                          <p className="text-[10px] text-stone-500 tabular-nums">{row.phone}</p>
                          {(row.street || row.zipCode) && (
                            <p className="text-[9px] text-stone-400 truncate mt-0.5">
                              {[row.street, row.number, row.zipCode].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>
                      ))}
                      {neighborhoodContacts.length > listPreview.length && (
                        <p className="text-[10px] text-center text-stone-400 py-2">
                          +{neighborhoodContacts.length - listPreview.length} contatos — exporte para ver todos
                        </p>
                      )}
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="zm-territory-map__rank-head">
                  <p className="zm-territory-map__rank-title">
                    {blumenauFocus ? '35 bairros oficiais' : 'Ranking territorial'}
                  </p>
                  <p className="zm-territory-map__rank-sub">
                    {regionLeadCount.toLocaleString('pt-BR')}
                    <span className="text-[13px] font-semibold text-slate-400 ml-1.5">leads mapeados</span>
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">{city}</p>
                </div>
                <div className="zm-territory-map__rank-list">
                  {topNeighborhoods.length === 0 ? (
                    <p className="text-[11px] text-slate-500 leading-relaxed px-1">
                      Cadastre CEP e bairro nos contatos ou use &quot;Mapear CEP&quot;.
                    </p>
                  ) : (
                    <ol className="space-y-1">
                      {topNeighborhoods.slice(0, 14).map(({ label, count }, i) => {
                        const nbName = label.split('·')[0]?.trim() || label;
                        const active =
                          selectedNb && normBlumenauNbKey(selectedNb) === normBlumenauNbKey(nbName);
                        return (
                          <li key={label}>
                            <button
                              type="button"
                              onClick={() => selectNeighborhood(label)}
                              className={`zm-territory-map__rank-item${active ? ' zm-territory-map__rank-item--active' : ''}`}
                            >
                              <div className="zm-territory-map__rank-row">
                                <span className="zm-territory-map__rank-name">
                                  <span className="text-slate-500 font-black mr-1.5 tabular-nums">{i + 1}</span>
                                  {nbName}
                                </span>
                                <span className="zm-territory-map__rank-count">
                                  {count.toLocaleString('pt-BR')}
                                </span>
                              </div>
                              <div className="zm-territory-map__rank-bar">
                                <div
                                  className="zm-territory-map__rank-bar-fill"
                                  style={{
                                    width: `${Math.round(
                                      (count / Math.max(1, topNeighborhoods[0]?.count || 1)) * 100
                                    )}%`
                                  }}
                                />
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              </>
            )}
          </aside>
        )}
      </div>

      {selectedNb && compact && neighborhoodContacts.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold text-stone-700">
            {selectedNb}: {neighborhoodContacts.length} contatos
          </span>
          <button
            type="button"
            onClick={handleExportCsv}
            className="text-[10px] font-bold text-indigo-600 hover:underline"
          >
            Exportar CSV
          </button>
        </div>
      )}

      {summary && (
        <p className={`mt-2 text-[10px] tabular-nums ${proUi ? 'text-slate-500' : 'text-stone-500'}`}>
          {summary.stats.filteredTotal.toLocaleString('pt-BR')} contatos na região
          {blumenauFocus ? ` · ${BLUMENAU_OFFICIAL_NEIGHBORHOODS.length} zonas` : ''}
          {summary.topConcentration
            ? ` · pico: ${summary.topConcentration.label.split('·')[0]?.trim()}`
            : ''}
          {summary.stale ? ' · sincronizando…' : ''}
        </p>
      )}
    </div>
  );
};
