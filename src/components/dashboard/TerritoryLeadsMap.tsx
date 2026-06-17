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
  type LeadsGeoSummary,
} from '../../services/leadsGeoApi';
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
  isBlumenauCity,
  matchOfficialNeighborhood,
  normBlumenauNbKey
} from '../../../shared/blumenauNeighborhoods';

const BLUMENAU_CENTER: L.LatLngExpression = [-26.9194, -49.0661];
const BLUMENAU_ZOOM = 12;

const CITY_PRESETS = [
  'Blumenau · SC',
  'Florianópolis · SC',
  'Joinville · SC',
  'Curitiba · PR',
  'São Paulo · SP',
  'Porto Alegre · RS',
];

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

function clusterRadius(count: number): number {
  return Math.min(42, 10 + Math.sqrt(count) * 4);
}

function clusterFill(count: number, max: number): string {
  const t = max > 0 ? count / max : 0;
  const alpha = 0.25 + t * 0.45;
  return `rgba(99, 102, 241, ${alpha})`;
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
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<L.Layer[]>([]);
  const lastGeoErrorToastRef = useRef(0);

  const [city, setCity] = useState(defaultCity);
  const [summary, setSummary] = useState<LeadsGeoSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('temperature');
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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [compact, mapActive]);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchLeadsGeoSummary({
        layer: 'neighborhood',
        city,
        neighborhood: selectedNb || undefined,
        light: true
      });
      setSummary(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar mapa.';
      const now = Date.now();
      if (now - lastGeoErrorToastRef.current > 12_000) {
        lastGeoErrorToastRef.current = now;
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [city, selectedNb]);

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
    if (!map || !summary) return;

    for (const layer of layersRef.current) {
      map.removeLayer(layer);
    }
    layersRef.current = [];

    const clusters = summary.clusters.filter((c) => c.lat != null && c.lng != null);
    const maxCount = Math.max(1, ...clusters.map((c) => c.count));

    const bindClusterClick = (circle: L.CircleMarker, cluster: (typeof clusters)[0], extra = '') => {
      const nbStats = blumenauNbStats?.get(normBlumenauNbKey(cluster.label));
      const tempLine =
        nbStats && nbStats.total > 0
          ? `<br/>${CONTACT_TEMP_LABEL[dominantNeighborhoodTemp(nbStats)]} · ${nbStats.hot}Q ${nbStats.warm}M ${nbStats.cold}F`
          : '';
      circle.bindPopup(
        `<strong>${cluster.label}</strong><br/>${cluster.count.toLocaleString('pt-BR')} contatos${tempLine}${extra}<br/>
        <span style="font-size:11px;color:#6366f1">Clique para ver a lista</span>`
      );
      circle.on('click', () => {
        selectNeighborhood(cluster.label);
      });
    };

    const paintClusterLabel = (lat: number, lng: number, count: number) => {
      if (count < 1) return;
      const label = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: `<span style="font-size:10px;font-weight:800;color:#1e1b4b;text-shadow:0 0 4px #fff">${count}</span>`,
          iconAnchor: [8, 8]
        }),
        interactive: false
      });
      label.addTo(map);
      layersRef.current.push(label);
    };

    if (viewMode === 'circles') {
      for (const cluster of clusters) {
        const { lat, lng } = fixBrazilCoord(cluster.lat!, cluster.lng!);
        if (!isMapCoordValid(lat, lng)) continue;
        const circle = L.circleMarker([lat, lng], {
          radius: Math.max(8, clusterRadius(cluster.count)),
          fillColor: clusterFill(cluster.count, maxCount),
          color: '#6366f1',
          weight: 2,
          opacity: 0.9,
          fillOpacity: cluster.count > 0 ? 0.85 : 0.25
        });
        bindClusterClick(circle, cluster);
        circle.addTo(map);
        layersRef.current.push(circle);
        if (cluster.count >= 3) paintClusterLabel(lat, lng, cluster.count);
      }
    } else if (viewMode === 'heatmap') {
      const points: [number, number, number][] = [];

      for (const cluster of clusters) {
        const { lat, lng } = fixBrazilCoord(cluster.lat!, cluster.lng!);
        if (!isMapCoordValid(lat, lng)) continue;
        const nbStats = blumenauNbStats?.get(normBlumenauNbKey(cluster.label));
        const temp = nbStats && nbStats.total > 0 ? dominantNeighborhoodTemp(nbStats) : 'new';
        const tempBoost =
          temp === 'hot' ? 1 : temp === 'warm' ? 0.75 : temp === 'cold' ? 0.5 : 0.3;
        const weight = (0.25 + (cluster.count / maxCount) * 0.75) * tempBoost;
        points.push([lat, lng, weight]);
      }

      if (points.length > 0) {
        const hl = heatLayer(points, {
          radius: compact ? 28 : 36,
          blur: compact ? 18 : 24,
          maxZoom: 14,
          minOpacity: 0.4,
          gradient: {
            0.1: '#38bdf8',
            0.35: '#6366f1',
            0.55: '#eab308',
            0.75: '#f97316',
            1: '#ef4444'
          }
        });
        hl.addTo(map);
        layersRef.current.push(hl);
      }

      for (const cluster of clusters) {
        const { lat, lng } = fixBrazilCoord(cluster.lat!, cluster.lng!);
        if (!isMapCoordValid(lat, lng)) continue;
        const hit = L.circleMarker([lat, lng], {
          radius: Math.max(16, clusterRadius(cluster.count)),
          fillOpacity: 0,
          opacity: 0,
          fillColor: '#000'
        });
        bindClusterClick(hit, cluster);
        hit.addTo(map);
        layersRef.current.push(hit);
      }
    } else {
      for (const cluster of clusters) {
        const { lat, lng } = fixBrazilCoord(cluster.lat!, cluster.lng!);
        if (!isMapCoordValid(lat, lng)) continue;
        const nbStats = blumenauNbStats?.get(normBlumenauNbKey(cluster.label));
        const count = nbStats?.total ?? cluster.count;
        const temp =
          nbStats && nbStats.total > 0 ? dominantNeighborhoodTemp(nbStats) : count > 0 ? 'new' : 'new';
        const color = TEMP_COLOR[temp];
        const circle = L.circleMarker([lat, lng], {
          radius: Math.max(10, clusterRadius(Math.max(1, count))),
          fillColor: color,
          color: '#fff',
          weight: 2,
          opacity: 0.95,
          fillOpacity: count > 0 ? 0.82 : 0.35
        });
        bindClusterClick(circle, cluster);
        circle.addTo(map);
        layersRef.current.push(circle);
        if (count >= 1) paintClusterLabel(lat, lng, count);
      }

      if (!blumenauFocus) {
        const pins = summary.contactPins.slice(0, compact ? 120 : 200);
        for (const pin of pins) {
          const { lat, lng } = fixBrazilCoord(pin.lat, pin.lng);
          if (!isMapCoordValid(lat, lng)) continue;
          const temp = tempsByContact[pin.id]?.temp || 'new';
          const marker = L.marker([lat, lng], {
            icon: tempIcon(TEMP_COLOR[temp], 10)
          });
          marker.bindPopup(`<strong>${pin.name}</strong><br/>${CONTACT_TEMP_LABEL[temp]}`);
          marker.addTo(map);
          layersRef.current.push(marker);
        }
      }
    }

    const vp = summary.mapViewport;
    if (vp) {
      map.flyTo([vp.lat, vp.lng], vp.zoom, { duration: 0.8 });
    } else if (blumenauFocus) {
      map.flyTo(BLUMENAU_CENTER, BLUMENAU_ZOOM, { duration: 0.6 });
    }
  }, [summary, viewMode, tempsByContact, city, compact, selectNeighborhood, blumenauNbStats, blumenauFocus]);

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
    const set = new Set<string>([...CITY_PRESETS, ...fromApi]);
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [summary?.filters.cities]);

  const viewModes: { id: ViewMode; label: string }[] = [
    { id: 'temperature', label: 'Temperatura' },
    { id: 'circles', label: 'Volume' },
    { id: 'heatmap', label: 'Calor' }
  ];

  const listPreview = neighborhoodContacts.slice(0, compact ? 40 : 80);

  return (
    <div
      ref={rootRef}
      className={`zm-territory-map flex flex-col ${compact ? 'h-[320px]' : 'h-[min(52vh,520px)]'}`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <MapPin className="w-4 h-4 text-indigo-500 shrink-0" />
          <input
            list="zm-city-presets"
            value={city}
            onChange={(e) => {
              setSelectedNb(null);
              setCity(e.target.value);
            }}
            className="flex-1 min-w-0 rounded-xl border border-stone-200/80 bg-white/90 px-3 py-2 text-[13px] font-semibold text-stone-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
            placeholder="Cidade · UF (ex: Blumenau · SC)"
          />
          <datalist id="zm-city-presets">
            {cityOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div className="flex gap-1 p-0.5 rounded-xl bg-stone-100 border border-stone-200/80">
          {viewModes.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setViewMode(m.id)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                viewMode === m.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-stone-500'
              }`}
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
        <div className="relative flex-1 min-w-0 rounded-2xl overflow-hidden border border-stone-200/90 shadow-inner bg-stone-100">
          <div ref={containerRef} className="absolute inset-0 z-0" />
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-sm">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
          )}
          {!mapActive && deferLoad && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-stone-50/90 text-[12px] font-semibold text-stone-500">
              Mapa carrega ao rolar até aqui…
            </div>
          )}

          <div className="absolute bottom-3 left-3 z-[500] flex flex-wrap gap-2">
            {viewMode === 'temperature' ? (
              (['hot', 'warm', 'cold', 'new'] as ContactTemperature[]).map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold bg-white/95 border border-stone-200 shadow-sm"
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: TEMP_COLOR[t] }} />
                  {CONTACT_TEMP_LABEL[t]} ({tempCounts[t]})
                </span>
              ))
            ) : viewMode === 'heatmap' ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold bg-white/95 border border-stone-200 shadow-sm text-stone-600">
                <span className="w-8 h-2 rounded-full bg-gradient-to-r from-sky-400 via-amber-400 to-red-500" />
                Calor por bairro (35 regiões)
              </span>
            ) : blumenauFocus ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold bg-white/95 border border-stone-200 shadow-sm text-stone-600">
                35 bairros · cor = temperatura dominante
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold bg-white/95 border border-stone-200 shadow-sm text-stone-600">
                <span className="w-3 h-3 rounded-full bg-indigo-500/60 border border-indigo-600" />
                Clique no bairro para ver contatos
              </span>
            )}
          </div>
        </div>

        {!compact && (
          <aside className="w-[240px] shrink-0 rounded-2xl border border-stone-200/90 bg-white/95 flex flex-col overflow-hidden hidden lg:flex">
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
              <div className="p-3 overflow-y-auto flex-1">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-stone-400 mb-2 flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {blumenauFocus
                    ? `35 bairros · ${city.split('·')[0]?.trim()}`
                    : `Top bairros · ${city.split('·')[0]?.trim()}`}
                </p>
                {topNeighborhoods.length === 0 ? (
                  <p className="text-[11px] text-stone-500 leading-relaxed">
                    Cadastre CEP e bairro nos contatos ou use &quot;Mapear CEP&quot; para posicionar leads.
                  </p>
                ) : (
                  <ol className="space-y-2 max-h-[min(42vh,360px)] overflow-y-auto pr-1">
                    {topNeighborhoods.map(({ label, count }, i) => (
                      <li key={label}>
                        <button
                          type="button"
                          onClick={() => selectNeighborhood(label)}
                          className="w-full text-left group"
                        >
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <span className="text-[11px] font-bold text-stone-800 truncate group-hover:text-indigo-700">
                              {i + 1}. {label.split('·')[0]?.trim()}
                            </span>
                            <span className="text-[11px] font-black tabular-nums text-indigo-600">
                              {count.toLocaleString('pt-BR')}
                            </span>
                          </div>
                          <div className="h-1 rounded-full bg-stone-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                              style={{
                                width: `${Math.round(
                                  (count / Math.max(1, topNeighborhoods[0]?.count || 1)) * 100
                                )}%`,
                              }}
                            />
                          </div>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}

                <div className="mt-4 pt-3 border-t border-stone-100 space-y-1.5">
                  <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Temperatura</p>
                  <div className="flex items-center gap-1.5 text-[10px] text-stone-600">
                    <Flame className="w-3 h-3 text-red-500" /> Quente
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-stone-600">
                    <Sun className="w-3 h-3 text-amber-500" /> Morno
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-stone-600">
                    <Snowflake className="w-3 h-3 text-sky-400" /> Frio
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-stone-600">
                    <Thermometer className="w-3 h-3 text-stone-400" /> Sem hist.
                  </div>
                </div>
              </div>
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
        <p className="mt-2 text-[10px] text-stone-500 tabular-nums">
          {summary.stats.filteredTotal.toLocaleString('pt-BR')} contatos na região ·{' '}
          {summary.stats.withNeighborhood.toLocaleString('pt-BR')} com bairro
          {blumenauFocus
            ? ` · ${BLUMENAU_OFFICIAL_NEIGHBORHOODS.length} bairros oficiais (mapa leve)`
            : ` · ${summary.pinStats?.pinsMapped ?? 0} pins por endereço/CEP`}
          {summary.topConcentration
            ? ` · maior bairro: ${summary.topConcentration.label.split('·')[0]?.trim()} (${summary.topConcentration.count})`
            : ''}
          {summary.stale ? ' · atualizando…' : ''}
        </p>
      )}
    </div>
  );
};
