/**
 * Atlas territorial — mapa imersivo + rio de temperatura + ranking por bairro.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Loader2, MapPin, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Contact, Conversation } from '../../types';
import {
  fetchLeadsGeoSummary,
  apiGeocodeContacts,
  type LeadsGeoSummary,
} from '../../services/leadsGeoApi';
import { useOperatingLocation } from '../../hooks/useOperatingLocation';
import { computeContactTemperatures } from '../../utils/contactTemperature';
import { fixBrazilCoord, isMapCoordValid } from '../../utils/brazilMapCoords';
import { isBlumenauCity, matchOfficialNeighborhood, normBlumenauNbKey } from '../../../shared/blumenauNeighborhoods';
import { TerritoryCitySearch } from './territory/TerritoryCitySearch';
import { TerritoryTempRiver } from './territory/TerritoryTempRiver';
import { TerritoryRankingTable } from './territory/TerritoryRankingTable';
import {
  BLUMENAU_CENTER,
  BLUMENAU_ZOOM,
  MAP_TILE_LIGHT,
  MAP_TILE_POSITRON,
  TEMP_ORDER,
} from './territory/territoryConstants';
import {
  buildNeighborhoodRows,
  filterClustersForScope,
  matchesCity,
  matchesNeighborhood,
  rowMatchesTempFilter,
  sumRegionTemps,
} from './territory/buildNeighborhoodRows';
import { flyToNeighborhoodRows, paintTerritoryHeat } from './territory/territoryMapLayers';
import type { NeighborhoodContactRow, NeighborhoodRow, RegionScope, TempFilter } from './territory/types';

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
  const { cityLabel: city, applyCityLabel, loading: locationLoading, saving: locationSaving } =
    useOperatingLocation(defaultCity);

  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<L.Layer[]>([]);
  const lastViewportKeyRef = useRef('');
  const lastGeoErrorToastRef = useRef(0);

  const [summary, setSummary] = useState<LeadsGeoSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [scope, setScope] = useState<RegionScope>('city');
  const [tempFilter, setTempFilter] = useState<TempFilter>('all');
  const [selectedRow, setSelectedRow] = useState<NeighborhoodRow | null>(null);
  const [mapActive, setMapActive] = useState(!deferLoad);

  const blumenauFocus = isBlumenauCity(city) && scope === 'city';
  const stateCode = city.split('·')[1]?.trim() || '';
  const isBusy = loading || geocoding || locationSaving || locationLoading;

  const tempsByContact = useMemo(
    () => computeContactTemperatures(contacts, conversations),
    [contacts, conversations]
  );

  const clusters = useMemo(() => {
    if (!summary) return [];
    return filterClustersForScope(summary.clusters, city, scope, blumenauFocus);
  }, [summary, city, scope, blumenauFocus]);

  const allRows = useMemo(
    () =>
      buildNeighborhoodRows({
        contacts,
        city,
        scope,
        tempsByContact,
        clusters,
        blumenauFocus,
      }),
    [contacts, city, scope, tempsByContact, clusters, blumenauFocus]
  );

  const visibleRows = useMemo(
    () => allRows.filter((r) => rowMatchesTempFilter(r, tempFilter)),
    [allRows, tempFilter]
  );

  const regionTemps = useMemo(() => sumRegionTemps(allRows), [allRows]);
  const regionTotal = regionTemps.hot + regionTemps.warm + regionTemps.cold + regionTemps.new;
  const nbWithData = allRows.filter((r) => r.count > 0).length;

  const neighborhoodContacts = useMemo((): NeighborhoodContactRow[] => {
    if (!selectedRow) return [];
    const nb = selectedRow.label;
    return contacts
      .filter((c) => {
        if (scope === 'city' && !matchesCity(c.city || '', city)) return false;
        if (scope === 'state' && stateCode) {
          const st = (c.state || '').trim();
          if (st && st.toUpperCase() !== stateCode.toUpperCase()) return false;
        }
        if (blumenauFocus) {
          const official = matchOfficialNeighborhood(c.neighborhood || '');
          return official === nb || matchesNeighborhood(c.neighborhood || '', nb);
        }
        return matchesNeighborhood(c.neighborhood || '', nb);
      })
      .map((c) => ({
        id: c.id,
        name: c.name || 'Sem nome',
        phone: c.phone || '',
        neighborhood: c.neighborhood || nb,
        zipCode: c.zipCode || '',
        street: c.street || '',
        number: c.number || '',
        temp: tempsByContact[c.id]?.temp || 'new',
      }))
      .sort((a, b) => {
        const td = TEMP_ORDER[a.temp] - TEMP_ORDER[b.temp];
        return td !== 0 ? td : a.name.localeCompare(b.name, 'pt-BR');
      });
  }, [selectedRow, contacts, city, scope, stateCode, tempsByContact, blumenauFocus]);

  const clearDataLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const layer of layersRef.current) map.removeLayer(layer);
    layersRef.current = [];
  }, []);

  const handleCityApply = useCallback(
    async (label: string) => {
      setSelectedRow(null);
      setSummary(null);
      setScope('city');
      lastViewportKeyRef.current = '';
      clearDataLayers();
      await applyCityLabel(label);
    },
    [applyCityLabel, clearDataLayers]
  );

  const handleScopeChange = (next: RegionScope) => {
    setScope(next);
    setSelectedRow(null);
    lastViewportKeyRef.current = '';
  };

  useEffect(() => {
    if (!mapActive || !containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: BLUMENAU_CENTER,
      zoom: BLUMENAU_ZOOM,
      zoomControl: true,
    });
    L.tileLayer(compact ? MAP_TILE_LIGHT : MAP_TILE_POSITRON, {
      attribution: compact ? '© OSM' : '© OSM © CARTO',
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
    setLoading(true);
    try {
      const data = await fetchLeadsGeoSummary({
        layer: 'neighborhood',
        city: scope === 'city' ? city : undefined,
        state: scope === 'state' ? stateCode : undefined,
        light: true,
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
  }, [city, scope, stateCode]);

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

    const rowsForMap = visibleRows.filter((r) => r.count > 0 && r.lat != null && r.lng != null);
    const normalized = rowsForMap
      .map((r) => {
        const { lat, lng } = fixBrazilCoord(r.lat!, r.lng!);
        return isMapCoordValid(lat, lng) ? { ...r, lat, lng } : null;
      })
      .filter(Boolean) as NeighborhoodRow[];

    layersRef.current = paintTerritoryHeat(
      map,
      normalized,
      selectedRow?.key ?? null,
      (row) => setSelectedRow(row)
    );

    const vpKey = `${city}|${scope}|${tempFilter}|${normalized.length}`;
    if (vpKey !== lastViewportKeyRef.current) {
      lastViewportKeyRef.current = vpKey;
      if (normalized.length > 0) {
        flyToNeighborhoodRows(map, normalized);
      } else if (summary?.mapViewport) {
        map.setView([summary.mapViewport.lat, summary.mapViewport.lng], summary.mapViewport.zoom, {
          animate: true,
        });
      } else if (blumenauFocus) {
        map.setView(BLUMENAU_CENTER, BLUMENAU_ZOOM, { animate: true });
      }
    }

    if (selectedRow?.lat != null && selectedRow.lng != null) {
      const { lat, lng } = fixBrazilCoord(selectedRow.lat, selectedRow.lng);
      if (isMapCoordValid(lat, lng)) {
        map.flyTo([lat, lng], Math.max(map.getZoom(), 13), { duration: 0.45 });
      }
    }
  }, [visibleRows, selectedRow, city, scope, tempFilter, summary, blumenauFocus, clearDataLayers]);

  useEffect(() => {
    paintMap();
  }, [paintMap]);

  const handleGeocode = async () => {
    setGeocoding(true);
    try {
      const r = await apiGeocodeContacts({ max: 80, city, force: false });
      setSummary(r.summary);
      lastViewportKeyRef.current = '';
      toast.success(`${r.geocoded} endereço(s) geolocalizado(s).`);
    } catch {
      toast.error('Falha ao mapear CEP.');
    } finally {
      setGeocoding(false);
    }
  };

  const handleExportCsv = () => {
    if (!selectedRow || neighborhoodContacts.length === 0) return;
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      ['Nome', 'Telefone', 'Bairro', 'Temperatura'].join(';'),
      ...neighborhoodContacts.map((r) =>
        [esc(r.name), esc(r.phone), esc(r.neighborhood), esc(r.temp)].join(';')
      ),
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bairro_${selectedRow.label.replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (compact) {
    return (
      <div ref={rootRef} className="h-[280px] flex flex-col gap-2">
        <TerritoryCitySearch value={city} onApply={handleCityApply} saving={locationSaving} />
        <div className="relative flex-1 rounded-xl overflow-hidden border border-stone-200">
          <div ref={containerRef} className="absolute inset-0" />
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="zm-atlas">
      <header className="zm-atlas__header">
        <div className="zm-atlas__header-text">
          <h2 className="zm-atlas__title">Atlas territorial</h2>
          <p className="zm-atlas__subtitle">
            {scope === 'city' ? city : `Estado ${stateCode}`}
            {' · '}
            {nbWithData} bairro{nbWithData !== 1 ? 's' : ''}
            {' · '}
            {regionTotal.toLocaleString('pt-BR')} leads
          </p>
        </div>
        <div className="zm-atlas__tools">
          <TerritoryCitySearch
            value={city}
            onApply={handleCityApply}
            saving={locationSaving}
            disabled={locationLoading}
          />
          {stateCode && (
            <div className="zm-atlas-scope" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={scope === 'city'}
                className={`zm-atlas-scope__btn${scope === 'city' ? ' zm-atlas-scope__btn--on' : ''}`}
                onClick={() => handleScopeChange('city')}
              >
                Cidade
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={scope === 'state'}
                className={`zm-atlas-scope__btn${scope === 'state' ? ' zm-atlas-scope__btn--on' : ''}`}
                onClick={() => handleScopeChange('state')}
              >
                {stateCode}
              </button>
            </div>
          )}
          <button
            type="button"
            className="zm-atlas-geocode"
            disabled={geocoding || loading}
            onClick={() => void handleGeocode()}
          >
            {geocoding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Atualizar CEP
          </button>
        </div>
      </header>

      <TerritoryTempRiver totals={regionTemps} activeFilter={tempFilter} onFilterChange={setTempFilter} />

      <div className="zm-atlas__map-wrap">
        <div ref={containerRef} className="zm-atlas__map" />
        {(isBusy || !summary) && mapActive && (
          <div className="zm-atlas__map-loading">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        {!mapActive && deferLoad && (
          <div className="zm-atlas__map-loading">Role para carregar o mapa</div>
        )}
        <div className="zm-atlas__map-pin">
          <MapPin className="w-3.5 h-3.5" />
          Halos = volume · cor = temperatura dominante
        </div>
      </div>

      <TerritoryRankingTable
        rows={visibleRows}
        selectedKey={selectedRow?.key ?? null}
        detailContacts={neighborhoodContacts}
        onSelect={setSelectedRow}
        onExportCsv={handleExportCsv}
      />
    </div>
  );
};
