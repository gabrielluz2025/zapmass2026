import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Download, Flame, Loader2, MapPin, RefreshCw, User, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, Select } from '../ui';
import { useZapMassConversations, useZapMassCore } from '../../context/ZapMassContext';
import { exportLeadsGeoXlsx } from '../../utils/exportLeadsGeoXlsx';
import {
  computeContactTemperatures,
  CONTACT_TEMP_LABEL,
  type ContactTemperature
} from '../../utils/contactTemperature';
import {
  apiGeocodeContacts,
  apiGeocodeLeadsClusters,
  fetchLeadsGeoConfig,
  fetchLeadsGeoSummary,
  type GeoCluster,
  type GeoContactPin,
  type GeoLayer,
  type LeadsGeoQuery,
  type LeadsGeoSummary
} from '../../services/leadsGeoApi';
import { fixBrazilCoord, isMapCoordValid } from '../../utils/brazilMapCoords';

type MapMode = 'heatmap' | 'circles' | 'pins';

const LAYER_LABELS: Record<GeoLayer, string> = {
  ddd: 'DDD (telefone)',
  city: 'Cidade',
  neighborhood: 'Bairro',
  state: 'Estado (UF)'
};

const PRECISION_LABELS: Record<string, string> = {
  neighborhood: 'Bairro',
  city: 'Cidade',
  ddd: 'DDD',
  state: 'UF',
  cep: 'CEP'
};

function useLocalMarkers(layer: GeoLayer, filterCity: string): boolean {
  return layer === 'neighborhood' || (layer === 'city' && Boolean(filterCity));
}

function clusterPixelRadius(count: number, maxCount: number, layer: GeoLayer): number {
  const t = maxCount > 0 ? Math.min(1, Math.sqrt(count / maxCount)) : 0;
  const base = layer === 'neighborhood' ? 10 : layer === 'city' ? 12 : 14;
  return base + t * (layer === 'neighborhood' ? 20 : 24);
}

function circleRadiusMeters(count: number, maxCount: number, layer: GeoLayer): number {
  const t = maxCount > 0 ? Math.min(1, Math.sqrt(count / maxCount)) : 0;
  const caps: Record<GeoLayer, [number, number]> = {
    neighborhood: [280, 1_400],
    city: [1_200, 6_500],
    ddd: [8_000, 35_000],
    state: [35_000, 90_000]
  };
  const [minR, maxR] = caps[layer];
  return minR + t * (maxR - minR);
}

const BRAZIL_BOUNDS = L.latLngBounds(
  L.latLng(-33.75, -73.99),
  L.latLng(5.27, -28.84)
);

const MAP_TILES = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
  },
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
  }
} as const;

/** Escala frio → quente (substitui HeatmapLayer removido na API 3.65). */
function heatStyle(count: number, maxCount: number, isTop: boolean): {
  fill: string;
  stroke: string;
  fillOpacity: number;
  strokeOpacity: number;
} {
  if (isTop) {
    return { fill: '#dc2626', stroke: '#7f1d1d', fillOpacity: 0.52, strokeOpacity: 0.85 };
  }
  const t = maxCount > 0 ? Math.min(1, count / maxCount) : 0;
  if (t >= 0.72) return { fill: '#ef4444', stroke: '#b91c1c', fillOpacity: 0.44, strokeOpacity: 0.55 };
  if (t >= 0.45) return { fill: '#f97316', stroke: '#c2410c', fillOpacity: 0.4, strokeOpacity: 0.5 };
  if (t >= 0.2) return { fill: '#eab308', stroke: '#a16207', fillOpacity: 0.36, strokeOpacity: 0.45 };
  return { fill: '#14b8a6', stroke: '#0f766e', fillOpacity: 0.3, strokeOpacity: 0.4 };
}

function neighborhoodsForCity(cityFilter: string, neighborhoods: string[]): string[] {
  if (!cityFilter) return neighborhoods;
  const cityPart = cityFilter.split('·')[0].trim().toLowerCase();
  return neighborhoods.filter((n) => n.toLowerCase().includes(cityPart));
}

function normGeoKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/g, '');
}

function pinMatchesCluster(pin: GeoContactPin, cluster: GeoCluster, activeLayer: GeoLayer): boolean {
  if (activeLayer === 'neighborhood') {
    return (
      normGeoKey(pin.neighborhood) === normGeoKey(cluster.neighborhood) &&
      normGeoKey(pin.city) === normGeoKey(cluster.city)
    );
  }
  if (activeLayer === 'city') {
    return (
      normGeoKey(pin.city) === normGeoKey(cluster.city) &&
      (cluster.state === '—' || normGeoKey(pin.state) === normGeoKey(cluster.state))
    );
  }
  if (activeLayer === 'state') {
    return cluster.state === '—' || normGeoKey(pin.state) === normGeoKey(cluster.state);
  }
  return true;
}

function clusterFilterLabel(cluster: GeoCluster): string {
  return cluster.label;
}

const LEAD_TEMP_COLORS: Record<ContactTemperature, string> = {
  hot: '#ef4444',
  warm: '#f97316',
  cold: '#3b82f6',
  new: '#94a3b8'
};

function contactPinIcon(pin: GeoContactPin, temp: ContactTemperature = 'new'): L.DivIcon {
  const color = LEAD_TEMP_COLORS[temp];
  const ring = temp === 'hot' ? 'box-shadow:0 0 0 2px #fecaca;' : '';
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);font-size:13px;line-height:1;${ring}">👤</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
}

function pinPopupHtml(pin: GeoContactPin, temp: ContactTemperature = 'new'): string {
  const addr = [pin.street, pin.number].filter(Boolean).join(', ');
  const lines = [
    `<strong>${pin.name}</strong>`,
    `<span style="color:${LEAD_TEMP_COLORS[temp]};font-weight:600">${CONTACT_TEMP_LABEL[temp]}</span>`,
    addr ? `${addr}` : '',
    pin.neighborhood ? `Bairro: ${pin.neighborhood}` : '',
    pin.city ? `${pin.city}${pin.state ? ` · ${pin.state}` : ''}` : '',
    `<span style="color:#64748b">${PRECISION_LABELS[pin.precision] || pin.precision}</span>`
  ].filter(Boolean);
  return `<div style="font-family:system-ui;font-size:12px;max-width:240px">${lines.join('<br/>')}</div>`;
}

function popupHtml(cluster: GeoCluster, title?: string): string {
  const samples =
    cluster.sampleNames.length > 0
      ? `<br/><span style="color:#94a3b8;font-size:11px">${cluster.sampleNames.slice(0, 2).join(', ')}</span>`
      : '';
  const head = title ? `<strong style="color:#dc2626">${title}</strong><br/>` : `<strong>${cluster.label}</strong><br/>`;
  return `<div style="font-family:system-ui;font-size:12px;max-width:240px">
    ${head}
    ${title ? `<span>${cluster.label}</span><br/>` : ''}
    <span>${cluster.count.toLocaleString('pt-BR')} contato(s)</span><br/>
    <span style="color:#64748b">${PRECISION_LABELS[cluster.precision] || cluster.precision}</span>
    ${samples}
  </div>`;
}

export const LeadsConcentrationMap: React.FC = () => {
  const { contacts } = useZapMassCore();
  const conversations = useZapMassConversations();
  const contactTemps = useMemo(
    () => computeContactTemperatures(contacts, conversations),
    [contacts, conversations]
  );

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [geocoding, setGeocoding] = useState(false);
  const [config, setConfig] = useState<{
    enabled: boolean;
    geocodeEnabled: boolean;
    mapKey: string | null;
  } | null>(null);
  const [summary, setSummary] = useState<LeadsGeoSummary | null>(null);
  const [layer, setLayer] = useState<GeoLayer>('city');
  const [mapMode, setMapMode] = useState<MapMode>('heatmap');
  const [filterState, setFilterState] = useState('');
  const [filterCity, setFilterCity] = useState('');
  const [filterDdd, setFilterDdd] = useState('');
  const [filterNeighborhood, setFilterNeighborhood] = useState('');
  /** Clique no ranking/chips — mapa exibe só esta região até desmarcar. */
  const [selectedClusterKey, setSelectedClusterKey] = useState<string | null>(null);

  const query = useMemo<LeadsGeoQuery>(
    () => ({
      layer,
      state: filterState || undefined,
      city: filterCity || undefined,
      ddd: filterDdd || undefined,
      neighborhood: filterNeighborhood || undefined
    }),
    [layer, filterState, filterCity, filterDdd, filterNeighborhood]
  );

  const allValidClusters = useMemo(
    () =>
      (summary?.clusters || []).filter(
        (c) =>
          c.lat != null &&
          c.lng != null &&
          isMapCoordValid(c.lat, c.lng, c.city !== '—' ? c.city : undefined, c.state !== '—' ? c.state : undefined)
      ),
    [summary?.clusters]
  );

  const selectedCluster = useMemo(
    () => (summary?.clusters || []).find((c) => c.key === selectedClusterKey) ?? null,
    [summary?.clusters, selectedClusterKey]
  );

  const displayClusters = useMemo(() => {
    if (!selectedClusterKey) return allValidClusters;
    const hit = allValidClusters.filter((c) => c.key === selectedClusterKey);
    if (hit.length > 0) return hit;
    const raw = (summary?.clusters || []).filter((c) => c.key === selectedClusterKey && c.lat != null && c.lng != null);
    return raw;
  }, [allValidClusters, selectedClusterKey, summary?.clusters]);

  const allValidPins = useMemo(
    () =>
      (summary?.contactPins || []).filter((p) =>
        isMapCoordValid(p.lat, p.lng, p.city, p.state)
      ),
    [summary?.contactPins]
  );

  const displayPins = useMemo(() => {
    if (!selectedCluster) return allValidPins;
    return allValidPins.filter((p) => pinMatchesCluster(p, selectedCluster, layer));
  }, [allValidPins, selectedCluster, layer]);

  const pinStats = summary?.pinStats;

  const topList = useMemo(() => (summary?.clusters || []).slice(0, 25), [summary?.clusters]);

  const cityNbEntries = useMemo(() => {
    if (!filterCity || !summary?.byNeighborhood) return [];
    const cityPart = filterCity.split('·')[0].trim().toLowerCase();
    return Object.entries(summary.byNeighborhood)
      .filter(([k]) => k.toLowerCase().includes(cityPart))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16);
  }, [filterCity, summary?.byNeighborhood]);

  const cityNeighborhoods = useMemo(
    () => neighborhoodsForCity(filterCity, summary?.filters?.neighborhoods || []),
    [filterCity, summary?.filters?.neighborhoods]
  );

  const handleCityFilter = (value: string, opts?: { switchToNeighborhood?: boolean }) => {
    setFilterCity(value);
    setFilterNeighborhood('');
    setSelectedClusterKey(null);
    if (value && layer === 'city' && opts?.switchToNeighborhood !== false) {
      setLayer('neighborhood');
    }
  };

  const clearClusterSelection = useCallback(() => {
    setSelectedClusterKey(null);
    if (layer === 'neighborhood') setFilterNeighborhood('');
    else if (layer === 'city') setFilterCity('');
    else if (layer === 'ddd') setFilterDdd('');
    else if (layer === 'state') setFilterState('');
  }, [layer]);

  const applyClusterFilter = useCallback(
    (cluster: GeoCluster) => {
      if (layer === 'state') {
        setFilterState(cluster.state !== '—' ? cluster.state : '');
        setFilterCity('');
        setFilterDdd('');
        setFilterNeighborhood('');
        return;
      }
      if (layer === 'ddd') {
        setFilterDdd(cluster.ddd !== '—' ? cluster.ddd : '');
        setFilterNeighborhood('');
        return;
      }
      if (layer === 'city') {
        setFilterDdd('');
        setFilterNeighborhood('');
        if (cluster.city !== '—') {
          const cityVal =
            cluster.state !== '—' ? `${cluster.city} · ${cluster.state}` : cluster.city;
          setFilterCity(cityVal);
          if (cluster.state !== '—') setFilterState(cluster.state);
        }
        return;
      }
      if (layer === 'neighborhood') {
        setFilterDdd('');
        if (cluster.state !== '—') setFilterState(cluster.state);
        if (cluster.city !== '—' && cluster.state !== '—') {
          setFilterCity(`${cluster.city} · ${cluster.state}`);
        }
        if (cluster.neighborhood !== '—' && cluster.city !== '—') {
          setFilterNeighborhood(`${cluster.neighborhood} · ${cluster.city}`);
        } else if (cluster.neighborhood !== '—') {
          setFilterNeighborhood(cluster.neighborhood);
        }
      }
    },
    [layer]
  );

  const zoomToCluster = useCallback((cluster: GeoCluster) => {
    if (!mapInstanceRef.current || cluster.lat == null || cluster.lng == null) return;
    const zoom =
      layer === 'neighborhood' ? 14 : layer === 'city' ? 11 : layer === 'ddd' ? 8 : 6;
    const { lat, lng } = fixBrazilCoord(cluster.lat, cluster.lng);
    mapInstanceRef.current.setView([lat, lng], zoom, { animate: true });
  }, [layer]);

  const handleClusterClick = useCallback(
    (cluster: GeoCluster) => {
      if (selectedClusterKey === cluster.key) {
        clearClusterSelection();
        return;
      }
      setSelectedClusterKey(cluster.key);
      applyClusterFilter(cluster);
      window.setTimeout(() => zoomToCluster(cluster), 80);
    },
    [selectedClusterKey, clearClusterSelection, applyClusterFilter, zoomToCluster]
  );

  const findClusterKeyForNeighborhood = useCallback(
    (nbKey: string) => {
      const nbPart = nbKey.split('·')[0]?.trim() || nbKey;
      const hit = (summary?.clusters || []).find(
        (c) =>
          normGeoKey(c.neighborhood) === normGeoKey(nbPart) ||
          c.label === nbKey ||
          `${c.neighborhood} · ${c.city}` === nbKey
      );
      return hit?.key ?? null;
    },
    [summary?.clusters]
  );

  const refreshSummary = useCallback(async (q: LeadsGeoQuery = query) => {
    setLoading(true);
    try {
      const [cfg, sum] = await Promise.all([fetchLeadsGeoConfig(), fetchLeadsGeoSummary(q)]);
      setConfig(cfg);
      setSummary(sum);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar mapa de leads.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void refreshSummary(query);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const destroyMap = useCallback(() => {
    layerGroupRef.current = null;
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }
  }, []);

  const renderMap = useCallback(() => {
    const hasClusters = displayClusters.length > 0;
    const hasPins = displayPins.length > 0;
    if (!mapRef.current || (!hasClusters && !hasPins)) return;

    const isDark =
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark');
    const tiles = isDark ? MAP_TILES.dark : MAP_TILES.light;
    const viewport = summary?.mapViewport;

    if (!mapInstanceRef.current) {
      const initial = viewport
        ? L.latLng(viewport.lat, viewport.lng)
        : L.latLng(-26.9, -49.06);
      const initialZoom = viewport?.zoom ?? 7;
      mapInstanceRef.current = L.map(mapRef.current, {
        zoomControl: true,
        minZoom: 4,
        maxZoom: 18
      }).setView(initial, initialZoom);
      L.tileLayer(tiles.url, { attribution: tiles.attribution, maxZoom: 19 }).addTo(
        mapInstanceRef.current
      );
      layerGroupRef.current = L.layerGroup().addTo(mapInstanceRef.current);
    }

    layerGroupRef.current?.clearLayers();
    const group = layerGroupRef.current!;
    const bounds = L.latLngBounds([]);
    const topKey = summary?.topConcentration?.key;
    const maxCount = Math.max(...displayClusters.map((c) => c.count), 1);
    const singleSelection = displayClusters.length === 1;
    const maxZoom = singleSelection ? 14 : filterCity || filterNeighborhood ? 13 : layer === 'neighborhood' ? 11 : 9;
    const localMarkers = useLocalMarkers(layer, filterCity) || singleSelection;
    const usePixelHeat = !localMarkers;

    if (mapMode !== 'pins' && hasClusters) {
      for (const cluster of displayClusters) {
        const { lat, lng } = fixBrazilCoord(cluster.lat!, cluster.lng!);
        if (!isMapCoordValid(lat, lng, cluster.city, cluster.state)) continue;
        bounds.extend([lat, lng]);
        const isTop = cluster.key === topKey;
        const style = heatStyle(cluster.count, maxCount, isTop);

        if (localMarkers || usePixelHeat) {
          const r = clusterPixelRadius(cluster.count, maxCount, layer);
          L.circleMarker([lat, lng], {
            radius: r,
            color: style.stroke,
            weight: isTop ? 2.5 : 1.5,
            opacity: 0.92,
            fillColor: mapMode === 'heatmap' ? style.fill : isTop ? '#ef4444' : '#14b8a6',
            fillOpacity: mapMode === 'heatmap' ? style.fillOpacity : 0.58
          })
            .bindPopup(popupHtml(cluster, isTop ? 'Maior concentração' : undefined))
            .bindTooltip(
              `<span style="font:600 11px system-ui">${cluster.label}</span><br/><span style="font:700 12px system-ui">${cluster.count.toLocaleString('pt-BR')}</span>`,
              { direction: 'top', opacity: 0.92, sticky: true }
            )
            .addTo(group);
        } else if (mapMode === 'heatmap') {
          L.circle([lat, lng], {
            radius: circleRadiusMeters(cluster.count, maxCount, layer),
            color: style.stroke,
            weight: isTop ? 2 : 1,
            opacity: style.strokeOpacity,
            fillColor: style.fill,
            fillOpacity: style.fillOpacity * 0.55
          })
            .bindPopup(popupHtml(cluster))
            .addTo(group);
        } else {
          L.circle([lat, lng], {
            radius: circleRadiusMeters(cluster.count, maxCount, layer),
            color: isTop ? '#dc2626' : '#0d9488',
            weight: isTop ? 2 : 1,
            opacity: 0.75,
            fillColor: isTop ? '#ef4444' : '#14b8a6',
            fillOpacity: 0.32
          })
            .bindPopup(popupHtml(cluster))
            .addTo(group);
        }
      }
    }

    if (mapMode === 'pins' && hasPins) {
      const pinStep = displayPins.length > 180 ? Math.ceil(displayPins.length / 180) : 1;
      for (let i = 0; i < displayPins.length; i += pinStep) {
        const pin = displayPins[i]!;
        const { lat, lng } = fixBrazilCoord(pin.lat, pin.lng);
        bounds.extend([lat, lng]);
        const temp = contactTemps[pin.id]?.temp || 'new';
        L.marker([lat, lng], { icon: contactPinIcon(pin, temp) })
          .bindPopup(pinPopupHtml(pin, temp))
          .addTo(group);
      }
    }

    const map = mapInstanceRef.current;
    if (singleSelection && displayClusters[0]?.lat != null) {
      const c = displayClusters[0]!;
      const { lat, lng } = fixBrazilCoord(c.lat!, c.lng!);
      map.setView([lat, lng], maxZoom, { animate: false });
    } else if (viewport && !filterCity && !filterNeighborhood && !selectedClusterKey) {
      map.setView([viewport.lat, viewport.lng], viewport.zoom, { animate: false });
    } else if (bounds.isValid()) {
      const clipped = bounds.intersects(BRAZIL_BOUNDS) ? bounds : BRAZIL_BOUNDS;
      map.fitBounds(clipped, { padding: [40, 40], maxZoom });
    }
    window.setTimeout(() => map?.invalidateSize(), 120);
  }, [
    displayClusters,
    displayPins,
    contactTemps,
    mapMode,
    summary?.topConcentration?.key,
    summary?.mapViewport,
    filterCity,
    filterNeighborhood,
    selectedClusterKey,
    layer
  ]);

  useEffect(() => {
    const hasData = displayClusters.length > 0 || displayPins.length > 0;
    if (!loading && hasData) {
      renderMap();
    } else if (!hasData) {
      destroyMap();
    }
  }, [loading, displayClusters, displayPins, renderMap, destroyMap]);

  useEffect(() => () => destroyMap(), [destroyMap]);

  const focusTopConcentration = useCallback(() => {
    const top = summary?.topConcentration;
    if (!top) return;
    const cluster = (summary?.clusters || []).find((c) => c.key === top.key);
    if (cluster) {
      handleClusterClick(cluster);
    }
  }, [summary?.topConcentration, summary?.clusters, handleClusterClick]);

  const handleGeocode = async () => {
    if (layer === 'ddd' || layer === 'state') {
      toast('Camada DDD/UF já usa coordenadas aproximadas — não precisa geocodificar.', { icon: 'ℹ️' });
      return;
    }
    if (!config?.geocodeEnabled) {
      toast.error('Geocodificação indisponível no servidor.');
      return;
    }
    setGeocoding(true);
    const progressId = 'leads-geo-progress';
    try {
      const geoOpts = {
        layer,
        city: filterCity || undefined,
        neighborhood: filterNeighborhood || undefined
      };
      let totalClusters = 0;
      let totalContacts = 0;
      let lastSummary: LeadsGeoSummary | null = null;

      for (let round = 0; round < 40; round++) {
        const clusters = await apiGeocodeLeadsClusters({ max: 120, ...geoOpts, force: false });
        const contacts = await apiGeocodeContacts({ max: 80, ...geoOpts });
        lastSummary = contacts.summary;
        totalClusters += clusters.geocoded;
        totalContacts += contacts.geocoded;
        const pending =
          (contacts.summary.pinStats.pinsPending || 0) + (clusters.pending || 0);
        toast.loading(
          `Localizando… ${totalClusters + totalContacts} regiões/contatos · ${pending.toLocaleString('pt-BR')} pendentes`,
          { id: progressId }
        );
        if (clusters.geocoded + contacts.geocoded === 0) break;
      }

      toast.dismiss(progressId);
      if (lastSummary) setSummary(lastSummary);
      const total = totalClusters + totalContacts;
      if (total > 0) {
        toast.success(
          `${totalClusters} região(ões) e ${totalContacts} contato(s) localizados no mapa.`
        );
      } else if (lastSummary?.pinStats.pinsPending) {
        toast(
          `${lastSummary.pinStats.pinsPending} contato(s) ainda aguardam endereço completo.`,
          { icon: 'ℹ️' }
        );
      } else {
        toast.success('Mapa atualizado — todas as regiões conhecidas já estão posicionadas.');
      }
    } catch (e) {
      toast.dismiss(progressId);
      toast.error(e instanceof Error ? e.message : 'Falha na geocodificação.');
    } finally {
      setGeocoding(false);
    }
  };

  const handleLayerChange = (next: GeoLayer) => {
    setLayer(next);
    setSelectedClusterKey(null);
    if (next === 'neighborhood') setFilterNeighborhood('');
    if (next !== 'city' && next !== 'neighborhood') {
      setFilterCity('');
      setFilterNeighborhood('');
    }
  };

  const stats = summary?.stats;
  const filters = summary?.filters;
  const top = summary?.topConcentration;
  const filteredTotal = stats?.filteredTotal || 1;

  const handleExportXlsx = () => {
    if (!summary) return;
    try {
      const n = exportLeadsGeoXlsx(summary, { query, layer });
      toast.success(`Planilha XLSX com ${n} regiões (+ resumo e abas por cidade/bairro).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar XLSX.');
    }
  };

  const activeFilters = useMemo(
    () =>
      [
        filterState && {
          key: 'state',
          label: `UF ${filterState}`,
          clear: () => {
            setFilterState('');
            setSelectedClusterKey(null);
          }
        },
        filterDdd && {
          key: 'ddd',
          label: `DDD ${filterDdd}`,
          clear: () => {
            setFilterDdd('');
            setSelectedClusterKey(null);
          }
        },
        filterCity && {
          key: 'city',
          label: filterCity,
          clear: () => {
            handleCityFilter('');
            setSelectedClusterKey(null);
          }
        },
        filterNeighborhood && {
          key: 'nb',
          label: filterNeighborhood,
          clear: () => {
            setFilterNeighborhood('');
            setSelectedClusterKey(null);
          }
        }
      ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>,
    [filterState, filterDdd, filterCity, filterNeighborhood]
  );
  const needsGeocode =
    (layer === 'city' || layer === 'neighborhood') &&
    config?.geocodeEnabled &&
    ((pinStats?.pinsPending || 0) > 0 || (stats?.clustersPending || 0) > 0);
  const showEmptyMap =
    mapMode === 'pins' ? displayPins.length === 0 : displayClusters.length === 0;

  return (
    <Card className="zm-dash-section">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 mb-4">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center brand-soft shrink-0">
            <MapPin className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="ui-title text-[15px]">Onde moram seus leads</h3>
            <p className="ui-subtitle text-[12px]">
              Mapa gratuito (OpenStreetMap) — concentração por DDD, cidade, bairro e UF
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            leftIcon={<Download className="w-3.5 h-3.5" />}
            onClick={handleExportXlsx}
            disabled={loading || !summary}
            title="Baixar ranking, resumo e abas por cidade/bairro/DDD/UF"
          >
            XLSX
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
            onClick={() => void refreshSummary(query)}
            disabled={loading}
          >
            Atualizar
          </Button>
          {needsGeocode && (
            <Button
              type="button"
              size="sm"
              variant="primary"
              leftIcon={geocoding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
              onClick={() => void handleGeocode()}
            disabled={geocoding || loading || !config?.geocodeEnabled}
            title="Localiza bairros e contatos com endereço (OpenStreetMap gratuito)"
            >
              Localizar no mapa
            </Button>
          )}
        </div>
      </div>

      {loading && !summary ? (
        <div className="flex items-center justify-center py-16 text-slate-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          Carregando distribuição geográfica…
        </div>
      ) : !stats ? (
        <p className="text-sm text-slate-500 py-8 text-center">Sem dados de contatos.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 mb-4">
            <StatPill label="Total contatos" value={stats.filteredTotal} sub={stats.totalContacts !== stats.filteredTotal ? `de ${stats.totalContacts}` : undefined} />
            <StatPill label="Com telefone" value={stats.withPhone} />
            <StatPill label="Com cidade" value={stats.withCity} />
            <StatPill label="Com bairro" value={stats.withNeighborhood} />
            <StatPill
              label="Endereço completo"
              value={pinStats?.withFullAddress ?? 0}
              sub="rua + número"
            />
            <StatPill
              label="No mapa (👤)"
              value={pinStats?.pinsMapped ?? 0}
              sub={
                (pinStats?.pinsPending || 0) > 0
                  ? `${pinStats?.pinsPending} pendentes`
                  : undefined
              }
            />
            <StatPill label="Regiões" value={stats.clusters} sub={LAYER_LABELS[layer]} isText />
          </div>

          {top && (
            <div className="mb-4 rounded-xl border border-rose-200/80 bg-rose-50/70 dark:bg-rose-950/25 dark:border-rose-900/50 px-3 py-2.5 flex flex-wrap items-center gap-2">
              <Flame className="w-4 h-4 text-rose-600 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                  Maior concentração
                </p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                  {top.label} — {top.count.toLocaleString('pt-BR')} contatos ({top.sharePct}% do filtro)
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="shrink-0 text-rose-700 dark:text-rose-300"
                onClick={focusTopConcentration}
              >
                Focar no mapa
              </Button>
            </div>
          )}

          {activeFilters.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1">Filtros</span>
              {activeFilters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={f.clear}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-teal-600/15 text-teal-800 dark:text-teal-200 border border-teal-600/25 hover:bg-teal-600/25 transition-colors"
                >
                  {f.label}
                  <X className="w-3 h-3 opacity-70" />
                </button>
              ))}
              <span className="text-[11px] text-slate-400 ml-1">
                {stats.clusters} regiões · clique no ranking para filtrar o mapa
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-3">
            <FilterSelect label="Camada" value={layer} onChange={(v) => handleLayerChange(v as GeoLayer)}>
              {(Object.keys(LAYER_LABELS) as GeoLayer[]).map((k) => (
                <option key={k} value={k}>{LAYER_LABELS[k]}</option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="UF"
              value={filterState}
              onChange={(v) => {
                setFilterState(v);
                if (!v) {
                  setSelectedClusterKey(null);
                  return;
                }
                const hit = (summary?.clusters || []).find(
                  (c) => c.state === v || c.label === v
                );
                setSelectedClusterKey(hit?.key ?? null);
              }}
            >
              <option value="">Todas</option>
              {(filters?.states || []).map((s) => (
                <option key={s} value={s}>{s} ({summary?.byState[s] ?? 0})</option>
              ))}
            </FilterSelect>
            <FilterSelect
              label="DDD"
              value={filterDdd}
              onChange={(v) => {
                setFilterDdd(v);
                if (!v) {
                  setSelectedClusterKey(null);
                  return;
                }
                const hit = (summary?.clusters || []).find((c) => c.ddd === v);
                setSelectedClusterKey(hit?.key ?? null);
              }}
            >
              <option value="">Todos</option>
              {(filters?.ddds || []).map((d) => (
                <option key={d} value={d}>DDD {d} ({summary?.byDdd[d] ?? 0})</option>
              ))}
            </FilterSelect>
            {(layer === 'city' || layer === 'neighborhood') && (
              <FilterSelect
                label="Cidade"
                value={filterCity}
                onChange={(v) => {
                  handleCityFilter(v, { switchToNeighborhood: layer === 'neighborhood' });
                  if (!v) {
                    setSelectedClusterKey(null);
                    return;
                  }
                  const hit = (summary?.clusters || []).find(
                    (c) => c.label === v || `${c.city} · ${c.state}` === v
                  );
                  setSelectedClusterKey(hit?.key ?? null);
                }}
              >
                <option value="">Todas</option>
                {(filters?.cities || []).map((c) => (
                  <option key={c} value={c}>{c} ({summary?.byCity[c] ?? 0})</option>
                ))}
              </FilterSelect>
            )}
            {layer === 'neighborhood' && (
              <FilterSelect
                label="Bairro"
                value={filterNeighborhood}
                onChange={(v) => {
                  setFilterNeighborhood(v);
                  setSelectedClusterKey(v ? findClusterKeyForNeighborhood(v) : null);
                }}
              >
                <option value="">Todos</option>
                {(filterCity ? cityNeighborhoods : filters?.neighborhoods || []).map((n) => (
                  <option key={n} value={n}>{n} ({summary?.byNeighborhood[n] ?? 0})</option>
                ))}
              </FilterSelect>
            )}
            <div className="flex items-end gap-1 ml-auto">
              <Button
                type="button"
                size="sm"
                variant={mapMode === 'heatmap' ? 'primary' : 'ghost'}
                leftIcon={<Flame className="w-3.5 h-3.5" />}
                onClick={() => setMapMode('heatmap')}
              >
                Calor
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mapMode === 'circles' ? 'primary' : 'ghost'}
                leftIcon={<MapPin className="w-3.5 h-3.5" />}
                onClick={() => setMapMode('circles')}
              >
                Círculos
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mapMode === 'pins' ? 'primary' : 'ghost'}
                leftIcon={<User className="w-3.5 h-3.5" />}
                onClick={() => setMapMode('pins')}
                title="Marca cada contato com endereço localizado"
              >
                Contatos
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.45fr_1fr] gap-4">
            <div
              className={`relative w-full rounded-xl overflow-hidden border border-slate-200/80 dark:border-slate-700/80 bg-slate-900 shadow-inner ring-1 ring-black/5 dark:ring-white/5 ${
                filterCity ? 'min-h-[420px] h-[500px]' : 'min-h-[380px] h-[440px]'
              }`}
            >
              <div ref={mapRef} className="absolute inset-0 w-full h-full" />
              {selectedCluster && (
                <div className="absolute top-3 left-3 z-[500] max-w-[min(100%,280px)] rounded-lg bg-rose-600/95 text-white px-3 py-2 shadow-lg border border-rose-500/50 pointer-events-none">
                  <p className="text-[9px] font-bold uppercase tracking-wider opacity-90">Exibindo no mapa</p>
                  <p className="text-[12px] font-bold truncate">{clusterFilterLabel(selectedCluster)}</p>
                  <p className="text-[10px] opacity-90 tabular-nums">
                    {selectedCluster.count.toLocaleString('pt-BR')} contato(s) · clique de novo para ver todos
                  </p>
                </div>
              )}
              {mapMode === 'pins' && displayPins.length > 0 && <LeadTempLegend />}
              {mapMode !== 'pins' && displayClusters.length > 0 && <HeatLegend />}
              {showEmptyMap && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 text-slate-500 bg-slate-100/90 dark:bg-slate-800/90 z-10 pointer-events-none">
                  <MapPin className="w-8 h-8 mb-2 opacity-40" />
                  <p className="text-sm font-medium">Nenhuma região para exibir.</p>
                  <p className="text-xs mt-1 max-w-sm">
                    {mapMode === 'pins'
                      ? 'Nenhum contato localizado ainda. Clique em Localizar no mapa (contatos com rua, número ou bairro).'
                      : layer === 'ddd'
                        ? 'Contatos precisam de telefone com DDD válido.'
                        : layer === 'state'
                          ? 'Contatos precisam de UF no cadastro ou DDD no telefone.'
                          : filterCity
                            ? 'Clique em Localizar no mapa para posicionar bairros com precisão.'
                            : 'Clique em uma cidade no ranking ou use Focar no mapa na maior concentração.'}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3 min-h-0">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Ranking — {LAYER_LABELS[layer]}
                </p>
                <div className="space-y-1 max-h-[340px] overflow-y-auto pr-1">
                  {topList.length === 0 ? (
                    <p className="text-xs text-slate-500">Nenhum contato neste filtro/camada.</p>
                  ) : (
                    topList.map((c, i) => (
                      <ClusterRow
                        key={c.key}
                        cluster={c}
                        rank={i + 1}
                        isTop={c.key === top?.key}
                        isSelected={selectedClusterKey === c.key}
                        maxCount={topList[0]?.count || 1}
                        filteredTotal={filteredTotal}
                        onFocus={() => handleClusterClick(c)}
                      />
                    ))
                  )}
                </div>
                {(summary?.clusters.length || 0) > topList.length && (
                  <p className="text-[10px] text-slate-400 mt-1">
                    +{(summary?.clusters.length || 0) - topList.length} no XLSX completo
                  </p>
                )}
              </div>
              {layer === 'neighborhood' && filterCity && cityNbEntries.length > 0 && (
                <NbChips
                  entries={cityNbEntries}
                  active={filterNeighborhood}
                  onPick={(nb) => {
                    const next = filterNeighborhood === nb ? '' : nb;
                    setFilterNeighborhood(next);
                    setSelectedClusterKey(next ? findClusterKeyForNeighborhood(nb) : null);
                  }}
                />
              )}
              {layer === 'ddd' && Object.keys(summary?.byDdd || {}).length > 0 && (
                <DddChips
                  byDdd={summary!.byDdd}
                  active={filterDdd}
                  onPick={(ddd) => {
                    const next = filterDdd === ddd ? '' : ddd;
                    setFilterDdd(next);
                    const cluster = (summary?.clusters || []).find((c) => c.ddd === next);
                    setSelectedClusterKey(next && cluster ? cluster.key : null);
                  }}
                />
              )}
            </div>
          </div>
        </>
      )}
    </Card>
  );
};

const FilterSelect: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}> = ({ label, value, onChange, children }) => (
  <label className="flex flex-col gap-0.5 min-w-[120px]">
    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
    <Select className="text-xs py-1.5 h-8" value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </Select>
  </label>
);

const StatPill: React.FC<{ label: string; value: number; sub?: string; isText?: boolean }> = ({
  label,
  value,
  sub,
  isText
}) => (
  <div className="rounded-xl px-3 py-2 border border-slate-200/80 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-900/30">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
    <p className="text-lg font-black tabular-nums text-slate-900 dark:text-white">
      {isText ? sub || '—' : value.toLocaleString('pt-BR')}
    </p>
    {!isText && sub && <p className="text-[10px] text-slate-400">{sub}</p>}
  </div>
);

const LeadTempLegend: React.FC = () => (
  <div className="absolute bottom-3 left-3 z-[500] rounded-lg bg-white/92 dark:bg-slate-900/92 border border-slate-200/80 dark:border-slate-700 px-2.5 py-1.5 shadow-sm pointer-events-none">
    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">Temperatura do lead</p>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-600 dark:text-slate-300">
      {(['hot', 'warm', 'cold', 'new'] as ContactTemperature[]).map((t) => (
        <span key={t} className="inline-flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: LEAD_TEMP_COLORS[t] }} />
          {CONTACT_TEMP_LABEL[t]}
        </span>
      ))}
    </div>
  </div>
);

const HeatLegend: React.FC = () => (
  <div className="absolute bottom-3 left-3 z-[500] rounded-lg bg-white/92 dark:bg-slate-900/92 border border-slate-200/80 dark:border-slate-700 px-2.5 py-1.5 shadow-sm pointer-events-none">
    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">Intensidade</p>
    <div className="flex items-center gap-1">
      {['#14b8a6', '#eab308', '#f97316', '#ef4444', '#dc2626'].map((c) => (
        <span key={c} className="w-5 h-2 rounded-sm" style={{ background: c }} />
      ))}
      <span className="text-[9px] text-slate-400 ml-0.5">menor → maior</span>
    </div>
  </div>
);

const ClusterRow: React.FC<{
  cluster: GeoCluster;
  rank: number;
  isTop?: boolean;
  isSelected?: boolean;
  maxCount: number;
  filteredTotal: number;
  onFocus?: () => void;
}> = ({ cluster, rank, isTop, isSelected, maxCount, filteredTotal, onFocus }) => {
  const barPct = maxCount > 0 ? Math.max(4, Math.round((100 * cluster.count) / maxCount)) : 0;
  const sharePct = filteredTotal > 0 ? Math.round((1000 * cluster.count) / filteredTotal) / 10 : 0;
  return (
    <button
      type="button"
      onClick={onFocus}
      className={`w-full text-left text-xs py-2 border-b border-slate-100 dark:border-slate-800/80 last:border-0 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
        isSelected
          ? 'bg-teal-600/15 dark:bg-teal-900/30 ring-2 ring-teal-500/60 -mx-1 px-1 rounded'
          : isTop
            ? 'bg-rose-50/60 dark:bg-rose-950/20 -mx-1 px-1 rounded'
            : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="min-w-0 flex items-center gap-1.5">
          <span className="w-4 text-[10px] font-mono text-slate-400 shrink-0">{rank}</span>
          <span className="truncate font-medium text-slate-800 dark:text-slate-100">{cluster.label}</span>
        </div>
        <div className="shrink-0 text-right">
          <span className="font-mono font-bold tabular-nums text-slate-600 dark:text-slate-300">
            {cluster.count.toLocaleString('pt-BR')}
          </span>
          <span className="text-[10px] text-slate-400 ml-1">{sharePct}%</span>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isTop ? 'bg-rose-500' : 'bg-teal-500/80'}`}
          style={{ width: `${barPct}%` }}
        />
      </div>
    </button>
  );
};

const NbChips: React.FC<{
  entries: [string, number][];
  active: string;
  onPick: (nb: string) => void;
}> = ({ entries, active, onPick }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Bairros rápidos</p>
    <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto">
      {entries.map(([nb, n]) => (
        <button
          key={nb}
          type="button"
          onClick={() => onPick(active === nb ? '' : nb)}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold transition-colors max-w-full truncate ${
            active === nb
              ? 'bg-rose-600 text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          <span className="truncate">{nb.split('·')[0].trim()}</span>
          <span className="font-mono tabular-nums opacity-80 shrink-0">{n}</span>
        </button>
      ))}
    </div>
  </div>
);

const DddChips: React.FC<{
  byDdd: Record<string, number>;
  active: string;
  onPick: (ddd: string) => void;
}> = ({ byDdd, active, onPick }) => {
  const entries = Object.entries(byDdd).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Por DDD</p>
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([ddd, n]) => (
          <button
            key={ddd}
            type="button"
            onClick={() => onPick(active === ddd ? '' : ddd)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold transition-colors ${
              active === ddd
                ? 'bg-teal-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {ddd}
            <span className="font-mono tabular-nums opacity-80">{n}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
