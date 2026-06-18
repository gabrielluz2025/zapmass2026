/**
 * Atlas territorial — compacto, colorido, pins por bairro + ficha do contato.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Contact, Conversation } from '../../types';
import {
  fetchLeadsGeoSummary,
  apiGeocodeContacts,
  type LeadsGeoSummary,
} from '../../services/leadsGeoApi';
import { useOperatingLocation } from '../../hooks/useOperatingLocation';
import { computeContactTemperatures } from '../../utils/contactTemperature';
import { parseGeoFilterCity } from '../../utils/contactAddressNormalize';
import { fixBrazilCoord, isMapCoordValid } from '../../utils/brazilMapCoords';
import {
  isBlumenauCity,
  matchOfficialNeighborhood,
} from '../../../shared/blumenauNeighborhoods';
import { TerritoryCitySearch } from './territory/TerritoryCitySearch';
import { TerritoryTempRiver } from './territory/TerritoryTempRiver';
import { TerritoryRankingTable } from './territory/TerritoryRankingTable';
import { TerritoryContactCard } from './territory/TerritoryContactCard';
import {
  BLUMENAU_CENTER,
  BLUMENAU_ZOOM,
  MAP_TILE_LIGHT,
  MAP_TILE_VOYAGER,
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
import { buildContactPinsForNeighborhood } from './territory/buildContactPins';
import {
  flyToContactPins,
  flyToNeighborhoodRows,
  paintContactPins,
  paintTerritoryHeat,
} from './territory/territoryMapLayers';
import type { MapContactPin, NeighborhoodContactRow, NeighborhoodRow, RegionScope, TempFilter } from './territory/types';

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
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [nbGeo, setNbGeo] = useState<LeadsGeoSummary | null>(null);
  const [nbGeoLoading, setNbGeoLoading] = useState(false);
  const [mapActive, setMapActive] = useState(!deferLoad);

  const deferredContacts = useDeferredValue(contacts);
  const deferredConversations = useDeferredValue(conversations);

  const blumenauFocus = isBlumenauCity(city) && scope === 'city';
  const parsedCity = useMemo(() => parseGeoFilterCity(city), [city]);
  const stateCode = parsedCity.state;
  const cityNameOnly = parsedCity.city;
  const isBusy = loading || geocoding || locationSaving || locationLoading;

  const cityContacts = useMemo(() => {
    if (!mapActive) return [];
    return deferredContacts.filter((c) => matchesCity(c.city || '', city, c.state || ''));
  }, [deferredContacts, city, mapActive]);

  const tempsByContact = useMemo(() => {
    if (!mapActive) return {};
    return computeContactTemperatures(cityContacts, deferredConversations);
  }, [cityContacts, deferredConversations, mapActive]);

  const clusters = useMemo(() => {
    if (!summary) return [];
    return filterClustersForScope(summary.clusters, city, scope, blumenauFocus);
  }, [summary, city, scope, blumenauFocus]);

  const allRows = useMemo(
    () =>
      buildNeighborhoodRows({
        contacts: cityContacts,
        city,
        scope,
        tempsByContact,
        clusters,
        blumenauFocus,
      }),
    [cityContacts, city, scope, tempsByContact, clusters, blumenauFocus]
  );

  const showAllNeighborhoods = blumenauFocus && scope === 'city';

  const visibleRows = useMemo(
    () => allRows.filter((r) => rowMatchesTempFilter(r, tempFilter, showAllNeighborhoods)),
    [allRows, tempFilter, showAllNeighborhoods]
  );

  const regionTemps = useMemo(() => sumRegionTemps(allRows), [allRows]);
  const regionTotal = regionTemps.hot + regionTemps.warm + regionTemps.cold + regionTemps.new;
  const nbWithData = allRows.filter((r) => r.count > 0).length;

  const neighborhoodContacts = useMemo((): NeighborhoodContactRow[] => {
    if (!selectedRow) return [];
    const nb = selectedRow.label;
    const pool = scope === 'state' ? deferredContacts : cityContacts;
    return pool
      .filter((c) => {
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
        city: c.city || '',
        state: c.state || '',
        temp: tempsByContact[c.id]?.temp || 'new',
        latitude: c.latitude,
        longitude: c.longitude,
        geocodePrecision: c.geocodePrecision,
      }))
      .sort((a, b) => {
        const td = TEMP_ORDER[a.temp] - TEMP_ORDER[b.temp];
        return td !== 0 ? td : a.name.localeCompare(b.name, 'pt-BR');
      });
  }, [selectedRow, cityContacts, deferredContacts, scope, stateCode, tempsByContact, blumenauFocus]);

  const contactPinsResult = useMemo(() => {
    if (!selectedRow) return { pins: [], unmapped: 0 };
    const cityName = cityNameOnly || city;
    return buildContactPinsForNeighborhood({
      contacts: neighborhoodContacts.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        neighborhood: c.neighborhood,
        zipCode: c.zipCode,
        street: c.street,
        number: c.number,
        city: c.city,
        state: c.state,
        temp: c.temp,
        latitude: c.latitude,
        longitude: c.longitude,
        geocodePrecision: c.geocodePrecision,
      })),
      apiPins: nbGeo?.contactPins || [],
      neighborhoodLabel: selectedRow.label,
      filterCity: cityName,
      filterState: stateCode,
    });
  }, [selectedRow, neighborhoodContacts, nbGeo?.contactPins, city, stateCode]);

  const contactPins = contactPinsResult.pins;
  const unmappedCount = contactPinsResult.unmapped;

  const selectedContact = useMemo(
    () => contactPins.find((p) => p.id === selectedContactId) ?? null,
    [contactPins, selectedContactId]
  );

  const clearDataLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const layer of layersRef.current) map.removeLayer(layer);
    layersRef.current = [];
  }, []);

  const handleCityApply = useCallback(
    async (label: string) => {
      setSelectedRow(null);
      setSelectedContactId(null);
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
    setSelectedContactId(null);
    lastViewportKeyRef.current = '';
  };

  const handleSelectRow = (row: NeighborhoodRow | null) => {
    setSelectedRow(row);
    setSelectedContactId(null);
    lastViewportKeyRef.current = '';
  };

  const handleSelectContact = useCallback((contactId: string) => {
    setSelectedContactId(contactId);
    const map = mapRef.current;
    const pin = contactPins.find((p) => p.id === contactId);
    if (map && pin) {
      map.flyTo([pin.lat, pin.lng], Math.max(map.getZoom(), 15), { duration: 0.35 });
    }
  }, [contactPins]);

  useEffect(() => {
    if (!mapActive || !containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: BLUMENAU_CENTER,
      zoom: BLUMENAU_ZOOM,
      zoomControl: true,
    });
    L.tileLayer(compact ? MAP_TILE_LIGHT : MAP_TILE_VOYAGER, {
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

  useEffect(() => {
    if (!mapActive || !selectedRow) {
      setNbGeo(null);
      return;
    }
    const cityName = cityNameOnly || city;
    const nbLabel = `${selectedRow.label} · ${cityName}`;
    let cancelled = false;
    setNbGeoLoading(true);
    void fetchLeadsGeoSummary({
      layer: 'neighborhood',
      city,
      neighborhood: nbLabel,
      light: false,
    })
      .then((data) => {
        if (!cancelled) setNbGeo(data);
      })
      .catch(() => {
        if (!cancelled) setNbGeo(null);
      })
      .finally(() => {
        if (!cancelled) setNbGeoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRow?.key, city, mapActive]);

  const paintMap = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    clearDataLayers();

    if (selectedRow) {
      if (contactPins.length > 0) {
        layersRef.current = paintContactPins(map, contactPins, selectedContactId, (pin) => {
          setSelectedContactId(pin.id);
          map.flyTo([pin.lat, pin.lng], Math.max(map.getZoom(), 15), { duration: 0.35 });
        });

        const vpKey = `nb|${selectedRow.key}|${contactPins.length}|${selectedContactId}`;
        if (vpKey !== lastViewportKeyRef.current) {
          lastViewportKeyRef.current = vpKey;
          flyToContactPins(map, contactPins);
        }
      } else if (selectedRow.lat != null && selectedRow.lng != null) {
        const { lat, lng } = fixBrazilCoord(selectedRow.lat, selectedRow.lng);
        if (isMapCoordValid(lat, lng)) {
          map.flyTo([lat, lng], 14, { duration: 0.45 });
        }
      }
      return;
    }

    const rowsForMap = visibleRows.filter((r) => r.count > 0 && r.lat != null && r.lng != null);
    const normalized = rowsForMap
      .map((r) => {
        const { lat, lng } = fixBrazilCoord(r.lat!, r.lng!);
        return isMapCoordValid(lat, lng) ? { ...r, lat, lng } : null;
      })
      .filter(Boolean) as NeighborhoodRow[];

    layersRef.current = paintTerritoryHeat(map, normalized, (row) => handleSelectRow(row));

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
  }, [
    visibleRows,
    selectedRow,
    contactPins,
    selectedContactId,
    city,
    scope,
    tempFilter,
    summary,
    blumenauFocus,
    clearDataLayers,
  ]);

  useEffect(() => {
    paintMap();
  }, [paintMap]);

  const handleGeocode = async () => {
    setGeocoding(true);
    try {
      const cityName = cityNameOnly || city;
      const r = await apiGeocodeContacts({
        max: 200,
        city,
        neighborhood: selectedRow ? `${selectedRow.label} · ${cityName}` : undefined,
        force: false,
      });
      setSummary(r.summary);
      if (selectedRow) {
        setNbGeo(r.summary);
      }
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
    <div ref={rootRef} className="zm-atlas zm-atlas--v2">
      <header className="zm-atlas__header zm-atlas__header--compact">
        <div className="zm-atlas__header-text">
          <h2 className="zm-atlas__title">Atlas territorial</h2>
          <p className="zm-atlas__subtitle">
            {scope === 'city' ? city : `Estado ${stateCode}`} · {nbWithData} bairros ·{' '}
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
            CEP
          </button>
        </div>
      </header>

      <TerritoryTempRiver totals={regionTemps} activeFilter={tempFilter} onFilterChange={setTempFilter} />

      <div className="zm-atlas__split">
        <div className="zm-atlas__map-wrap zm-atlas__map-wrap--compact">
          <div ref={containerRef} className="zm-atlas__map" />
          {(isBusy || !summary) && mapActive && (
            <div className="zm-atlas__map-loading">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}
          {!mapActive && deferLoad && (
            <div className="zm-atlas__map-loading">Role para carregar</div>
          )}
          {selectedRow ? (
            <div className="zm-atlas__map-badge zm-atlas__map-badge--focus">
              {selectedRow.label} · {contactPins.length} no mapa
              {unmappedCount > 0 && ` · ${unmappedCount} sem coordenada`}
              {nbGeoLoading && ' · carregando…'}
            </div>
          ) : (
            <div className="zm-atlas__map-badge">Clique num bairro para ver contatos</div>
          )}
          {selectedContact && (
            <TerritoryContactCard contact={selectedContact} onClose={() => setSelectedContactId(null)} />
          )}
        </div>

        <TerritoryRankingTable
          rows={visibleRows}
          selectedKey={selectedRow?.key ?? null}
          selectedContactId={selectedContactId}
          contacts={neighborhoodContacts}
          onSelectRow={handleSelectRow}
          onSelectContact={handleSelectContact}
          onExportCsv={handleExportCsv}
        />
      </div>
    </div>
  );
};
