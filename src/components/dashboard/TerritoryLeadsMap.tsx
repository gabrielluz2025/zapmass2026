/**
 * Mapa territorial de leads — analytics premium (Leaflet + micro-pills).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Loader2, RefreshCw, Thermometer, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Contact, Conversation } from '../../types';
import {
  fetchLeadsGeoSummary,
  apiGeocodeContacts,
  type GeoCluster,
  type LeadsGeoSummary,
} from '../../services/leadsGeoApi';
import { useOperatingLocation } from '../../hooks/useOperatingLocation';
import { computeContactTemperatures, CONTACT_TEMP_LABEL } from '../../utils/contactTemperature';
import type { ContactTemperature } from '../../utils/contactTemperature';
import { fixBrazilCoord, isMapCoordValid } from '../../utils/brazilMapCoords';
import { exportLeadsGeoXlsx } from '../../utils/exportLeadsGeoXlsx';
import { Button } from '../ui/Button';
import {
  BLUMENAU_OFFICIAL_NEIGHBORHOODS,
  blumenauSpreadCoord,
  isBlumenauCity,
  matchOfficialNeighborhood,
  normBlumenauNbKey,
} from '../../../shared/blumenauNeighborhoods';
import { TerritoryCitySearch } from './territory/TerritoryCitySearch';
import { TerritoryRankingPanel, type NeighborhoodContactRow } from './territory/TerritoryRankingPanel';
import {
  BLUMENAU_CENTER,
  BLUMENAU_ZOOM,
  MAP_TILE_DARK,
  MAP_TILE_LIGHT,
  TEMP_COLOR,
  TEMP_ORDER,
  type TerritoryViewMode,
} from './territory/territoryConstants';
import {
  buildBlumenauNbStats,
  clusterMatchesFilterCity,
  dominantNeighborhoodTemp,
  matchesCity,
  matchesNeighborhood,
  normalizeKey,
  type NbTempStats,
} from './territory/territoryMapUtils';
import { territoryMicroPillIcon, territoryTooltipHtml } from './territory/territoryMapMarkers';

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
      sampleNames: [],
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
      filteredTotal,
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
      neighborhoods: [...BLUMENAU_OFFICIAL_NEIGHBORHOODS],
    },
    topConcentration: null,
    contactPins: [],
    pinStats: { withFullAddress: 0, pinsMapped: 0, pinsApproximate: 0, pinsPending: 0 },
    mapViewport: { lat: BLUMENAU_CENTER[0], lng: BLUMENAU_CENTER[1], zoom: BLUMENAU_ZOOM },
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
  defaultCity?: string;
  compact?: boolean;
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
    applyCityLabel,
    loading: locationLoading,
    saving: locationSaving,
  } = useOperatingLocation(defaultCity);

  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<L.Layer[]>([]);
  const lastGeoErrorToastRef = useRef(0);
  const lastViewportKeyRef = useRef('');

  const [summary, setSummary] = useState<LeadsGeoSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiSyncing, setApiSyncing] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [viewMode, setViewMode] = useState<TerritoryViewMode>('temperature');
  const [selectedNb, setSelectedNb] = useState<string | null>(null);
  const [mapActive, setMapActive] = useState(!deferLoad);

  const blumenauFocus = isBlumenauCity(city);
  const proUi = !compact;
  const isBusy = loading || apiSyncing || geocoding || locationSaving || locationLoading;

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

  const mapSummary = blumenauFocus ? summary ?? localBlumenauSummary : summary;

  const filteredClusters = useMemo(() => {
    if (!mapSummary) return [];
    return mapSummary.clusters.filter(
      (c) =>
        c.lat != null &&
        c.lng != null &&
        (blumenauFocus || clusterMatchesFilterCity(c, city))
    );
  }, [mapSummary, city, blumenauFocus]);

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
      .slice(0, compact ? 8 : 14)
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

  const regionLeadCount = useMemo(() => {
    if (blumenauFocus && blumenauNbStats) {
      return [...blumenauNbStats.values()].reduce((acc, s) => acc + s.total, 0);
    }
    return mapSummary?.stats.filteredTotal ?? 0;
  }, [blumenauFocus, blumenauNbStats, mapSummary?.stats.filteredTotal]);

  const rankMaxCount = topNeighborhoods[0]?.count ?? 1;

  const clearDataLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const layer of layersRef.current) {
      map.removeLayer(layer);
    }
    layersRef.current = [];
  }, []);

  const selectNeighborhood = useCallback((nb: string) => {
    setSelectedNb(nb.split('·')[0]?.trim() || nb);
  }, []);

  const handleCityApply = useCallback(
    async (label: string) => {
      setSelectedNb(null);
      setSummary(null);
      lastViewportKeyRef.current = '';
      clearDataLayers();
      await applyCityLabel(label);
    },
    [applyCityLabel, clearDataLayers]
  );

  useEffect(() => {
    if (!mapActive || !containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: BLUMENAU_CENTER,
      zoom: BLUMENAU_ZOOM,
      zoomControl: !compact,
    });
    L.tileLayer(compact ? MAP_TILE_LIGHT : MAP_TILE_DARK, {
      attribution: compact ? '© OpenStreetMap' : '© OpenStreetMap © CARTO',
      subdomains: 'abcd',
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
        light: true,
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
  }, [city, blumenauFocus, localBlumenauSummary]);

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
    if (!map) return;

    clearDataLayers();
    if (!mapSummary) return;

    const clusters = filteredClusters.filter((c) => !blumenauFocus || c.count >= 1);
    const bounds = L.latLngBounds([] as L.LatLngExpression[]);

    for (const cluster of clusters) {
      const { lat, lng } = fixBrazilCoord(cluster.lat!, cluster.lng!);
      if (!isMapCoordValid(lat, lng)) continue;

      const nbStats = blumenauNbStats?.get(normBlumenauNbKey(cluster.label));
      const count = nbStats?.total ?? cluster.count;
      if (count < 1 && blumenauFocus) continue;

      const temp: ContactTemperature =
        nbStats && nbStats.total > 0 ? dominantNeighborhoodTemp(nbStats) : count > 0 ? 'new' : 'new';

      const nbKey = normBlumenauNbKey(cluster.label.split('·')[0]?.trim() || cluster.label);
      const isSelected = selectedNb ? normBlumenauNbKey(selectedNb) === nbKey : false;

      const tempLine =
        nbStats && nbStats.total > 0
          ? `${nbStats.hot} quentes · ${nbStats.warm} mornos`
          : undefined;

      const marker = L.marker([lat, lng], {
        icon: territoryMicroPillIcon({
          label: cluster.label,
          count,
          temp,
          viewMode,
          selected: isSelected,
        }),
        zIndexOffset: isSelected ? 1000 : Math.round(count),
      });

      marker.bindTooltip(territoryTooltipHtml(cluster.label, count, temp, tempLine), {
        className: 'zm-territory-tip-pane',
        direction: 'top',
        offset: [0, -8],
        opacity: 1,
      });

      marker.on('click', () => selectNeighborhood(cluster.label));
      marker.addTo(map);
      layersRef.current.push(marker);
      bounds.extend([lat, lng]);
    }

    const viewportKey = `${city}|${clusters.length}|${viewMode}`;
    if (viewportKey !== lastViewportKeyRef.current) {
      lastViewportKeyRef.current = viewportKey;
      const vp = mapSummary.mapViewport;
      if (bounds.isValid() && clusters.length > 0) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: true });
      } else if (vp) {
        map.setView([vp.lat, vp.lng], vp.zoom, { animate: true });
      } else if (blumenauFocus) {
        map.setView(BLUMENAU_CENTER, BLUMENAU_ZOOM, { animate: true });
      }
    }
  }, [
    mapSummary,
    filteredClusters,
    viewMode,
    selectedNb,
    city,
    blumenauNbStats,
    blumenauFocus,
    selectNeighborhood,
    clearDataLayers,
  ]);

  useEffect(() => {
    paintMap();
  }, [paintMap]);

  const handleGeocode = async () => {
    setGeocoding(true);
    try {
      const r = await apiGeocodeContacts({ max: 80, city, force: false });
      setSummary(r.summary);
      lastViewportKeyRef.current = '';
      toast.success(`${r.geocoded} endereço(s) mapeado(s).`);
    } catch {
      toast.error('Falha ao geocodificar endereços.');
    } finally {
      setGeocoding(false);
    }
  };

  const handleExportXlsx = () => {
    if (!summary || !selectedNb) return;
    try {
      exportLeadsGeoXlsx(summary, {
        layer: 'neighborhood',
        query: { layer: 'neighborhood', city, neighborhood: selectedNb },
      });
      toast.success('Excel exportado.');
    } catch {
      toast.error('Falha ao exportar Excel.');
    }
  };

  const handleExportCsv = () => {
    if (!selectedNb || neighborhoodContacts.length === 0) {
      toast.error('Nenhum contato neste bairro.');
      return;
    }
    downloadNeighborhoodCsv(neighborhoodContacts, city, selectedNb);
    toast.success(`${neighborhoodContacts.length} contato(s) exportado(s).`);
  };

  const viewModes: { id: TerritoryViewMode; label: string; icon: React.ReactNode }[] = [
    { id: 'temperature', label: 'Temperatura', icon: <Thermometer className="w-3 h-3" /> },
    { id: 'volume', label: 'Volume', icon: <Users className="w-3 h-3" /> },
  ];

  const rankingProps = {
    city,
    blumenauFocus,
    regionLeadCount,
    topNeighborhoods,
    rankMaxCount,
    selectedNb,
    neighborhoodContacts,
    nbTempBreakdown,
    loading: isBusy,
    onSelectNeighborhood: selectNeighborhood,
    onClearSelection: () => setSelectedNb(null),
    onExportCsv: handleExportCsv,
    onExportXlsx: handleExportXlsx,
    canExportXlsx: !!summary,
  };

  if (proUi) {
    return (
      <div ref={rootRef} className="zm-ta flex flex-col min-h-[520px] h-[min(62vh,640px)]">
        <header className="zm-ta-toolbar">
          <TerritoryCitySearch
            value={city}
            disabled={locationLoading}
            saving={locationSaving}
            onApply={handleCityApply}
          />

          <div className="zm-ta-toolbar__center">
            <div className="zm-ta-segment" role="tablist" aria-label="Modo de visualização">
              {viewModes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={viewMode === m.id}
                  onClick={() => setViewMode(m.id)}
                  className={`zm-ta-segment__btn${viewMode === m.id ? ' zm-ta-segment__btn--active' : ''}`}
                >
                  {m.icon}
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="zm-ta-toolbar__right">
            {selectedNb && (
              <button type="button" className="zm-ta-clear" onClick={() => setSelectedNb(null)}>
                Limpar · {selectedNb}
              </button>
            )}
            <button
              type="button"
              disabled={geocoding || loading}
              onClick={() => void handleGeocode()}
              className="zm-ta-geocode"
            >
              {geocoding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Mapear CEP
            </button>
          </div>
        </header>

        <div className="zm-ta-grid flex-1 min-h-0">
          <div className="zm-ta-map-wrap">
            <div ref={containerRef} className="zm-ta-map" />
            {(isBusy || !mapSummary) && mapActive && (
              <div className="zm-ta-map__overlay">
                <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
                <span>{geocoding ? 'Geocodificando…' : 'Carregando região…'}</span>
              </div>
            )}
            {!mapActive && deferLoad && (
              <div className="zm-ta-map__overlay zm-ta-map__overlay--idle">Mapa carrega ao rolar…</div>
            )}
            {viewMode === 'temperature' && mapSummary && !isBusy && (
              <div className="zm-ta-legend">
                {(['hot', 'warm', 'cold', 'new'] as ContactTemperature[]).map((t) => (
                  <span key={t} className="zm-ta-legend__item">
                    <span className="zm-ta-legend__dot" style={{ background: TEMP_COLOR[t] }} />
                    {CONTACT_TEMP_LABEL[t]}
                  </span>
                ))}
              </div>
            )}
          </div>

          <TerritoryRankingPanel {...rankingProps} layout="sidebar" />
        </div>

        <TerritoryRankingPanel {...rankingProps} layout="mobile" />

        {summary && (
          <p className="zm-ta-footer">
            {summary.stats.filteredTotal.toLocaleString('pt-BR')} contatos · {city}
            {summary.stale ? ' · sincronizando…' : ''}
          </p>
        )}
      </div>
    );
  }

  /* Modo compacto (embeds menores) */
  return (
    <div ref={rootRef} className="flex flex-col h-[320px] gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[200px]">
          <TerritoryCitySearch value={city} onApply={handleCityApply} saving={locationSaving} />
        </div>
        <div className="flex gap-0.5 p-0.5 rounded-lg border border-stone-200 bg-stone-50">
          {viewModes.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setViewMode(m.id)}
              className={`px-2 py-1 rounded text-[10px] font-semibold ${
                viewMode === m.id ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" disabled={geocoding || loading} onClick={() => void handleGeocode()}>
          CEP
        </Button>
      </div>
      <div className="relative flex-1 min-h-0 rounded-xl overflow-hidden border border-stone-200">
        <div ref={containerRef} className="absolute inset-0" />
        {isBusy && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm">
            <Loader2 className="w-6 h-6 animate-spin text-stone-500" />
          </div>
        )}
      </div>
    </div>
  );
};
