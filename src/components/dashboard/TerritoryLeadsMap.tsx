/**
 * Atlas territorial — compacto, colorido, pins por bairro + ficha do contato.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Contact, Conversation } from '../../types';
import {
  fetchLeadsGeoSummary,
  fetchOfficialNeighborhoods,
  type LeadsGeoSummary,
} from '../../services/leadsGeoApi';
import { useOperatingLocation } from '../../hooks/useOperatingLocation';
import { computeContactTemperatures } from '../../utils/contactTemperature';
import { parseGeoFilterCity } from '../../utils/contactAddressNormalize';
import { formatStateLabel, resolveBrazilStateCode, type TerritoryRegionApply } from '../../utils/territoryRegionFilter';
import { fixBrazilCoord, isMapCoordValid } from '../../utils/brazilMapCoords';
import {
  getStaticOfficialNeighborhoods,
  isBlumenauCity,
  resolveContactNeighborhoodForCity,
} from '../../../shared/officialNeighborhoods';
import { launchAtlasCampaign, saveAtlasContactsHint, type AtlasRegionLaunch } from '../../utils/atlasRegionLaunch';
import { TerritoryAtlasMeta } from './territory/TerritoryAtlasMeta';
import { TerritoryCitySearch } from './territory/TerritoryCitySearch';
import { TerritoryTempRiver } from './territory/TerritoryTempRiver';
import { TerritoryRankingTable } from './territory/TerritoryRankingTable';
import { TerritoryContactCard } from './territory/TerritoryContactCard';
import { TerritoryMapChrome } from './territory/TerritoryMapChrome';
import {
  BLUMENAU_CENTER,
  BLUMENAU_ZOOM,
  MAP_TILE_DARK,
  MAP_TILE_LIGHT,
  MAP_TILE_POSITRON,
  MAP_TILE_VOYAGER,
  TEMP_ORDER,
  type TerritoryViewMode,
} from './territory/territoryConstants';
import { buildCityRows } from './territory/buildCityRows';
import {
  buildNeighborhoodRows,
  filterClustersForScope,
  matchesCity,
  matchesNeighborhood,
  rowMatchesTempFilter,
  sumRegionTemps,
} from './territory/buildNeighborhoodRows';
import { matchesStateContact } from './territory/territoryMapUtils';
import {
  buildContactPinsForNeighborhood,
  buildContactPinsForScope,
  capMapContactPins,
} from './territory/buildContactPins';
import {
  flyToContactPins,
  flyToNeighborhoodRows,
} from './territory/territoryMapLayers';
import {
  paintContactPins,
  paintContactsHeat,
  paintNeighborhoodLayer,
  type ContactViz,
  type MapTileId,
  type NeighborhoodViz,
} from './territory/territoryMapPro';
import type { MapContactPin, NeighborhoodContactRow, NeighborhoodRow, RegionScope, TempFilter } from './territory/types';

type MapViewMode = 'neighborhoods' | 'contacts';

type Props = {
  contacts: Contact[];
  conversations: Conversation[];
  defaultCity?: string;
  compact?: boolean;
  deferLoad?: boolean;
  contactsSavedTotal?: number | null;
  contactsHasMore?: boolean;
  contactsLoadingMore?: boolean;
  onNavigate?: (view: 'campaigns' | 'contacts') => void;
};

export const TerritoryLeadsMap: React.FC<Props> = ({
  contacts,
  conversations,
  defaultCity = 'Blumenau · SC',
  compact = false,
  deferLoad = false,
  contactsSavedTotal = null,
  contactsHasMore = false,
  contactsLoadingMore = false,
  onNavigate,
}) => {
  const { cityLabel: city, applyCityLabel, loading: locationLoading, saving: locationSaving } =
    useOperatingLocation(defaultCity);

  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dataLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const layersRef = useRef<L.Layer[]>([]);
  const lastViewportKeyRef = useRef('');
  const lastGeoErrorToastRef = useRef(0);

  const [summary, setSummary] = useState<LeadsGeoSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<RegionScope>('city');
  const [tempFilter, setTempFilter] = useState<TempFilter>('all');
  const [selectedRow, setSelectedRow] = useState<NeighborhoodRow | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [nbGeo, setNbGeo] = useState<LeadsGeoSummary | null>(null);
  const [scopeGeo, setScopeGeo] = useState<LeadsGeoSummary | null>(null);
  const [nbGeoLoading, setNbGeoLoading] = useState(false);
  const [mapActive, setMapActive] = useState(!deferLoad);
  const [cityOfficialList, setCityOfficialList] = useState<string[] | null>(null);
  const [stateRegionLabel, setStateRegionLabel] = useState<string | null>(null);
  const [stateDrillCity, setStateDrillCity] = useState<string | null>(null);
  const [mapViewMode, setMapViewMode] = useState<MapViewMode>('neighborhoods');
  const [neighborhoodViz, setNeighborhoodViz] = useState<NeighborhoodViz>('heat');
  const [contactViz, setContactViz] = useState<ContactViz>('heat');
  const [territoryViewMode, setTerritoryViewMode] = useState<TerritoryViewMode>('temperature');
  const [mapTile, setMapTile] = useState<MapTileId>('dark');

  const deferredContacts = useDeferredValue(contacts);
  const deferredConversations = useDeferredValue(conversations);

  const blumenauFocus = isBlumenauCity(city) && scope === 'city';
  const parsedCity = useMemo(() => parseGeoFilterCity(city), [city]);
  const cityStateCode = parsedCity.state;
  const effectiveState =
    scope === 'state'
      ? stateRegionLabel?.split('·').pop()?.trim() || cityStateCode || ''
      : cityStateCode;

  const regionSearchValue =
    scope === 'state' && effectiveState
      ? stateRegionLabel ||
        (resolveBrazilStateCode(effectiveState)
          ? formatStateLabel(resolveBrazilStateCode(effectiveState)!)
          : effectiveState)
      : city;

  const cityNameOnly = parsedCity.city;
  const stateCode = effectiveState;

  const officialNeighborhoods = useMemo(() => {
    if (scope === 'city' || (scope === 'state' && stateDrillCity)) return cityOfficialList;
    return null;
  }, [scope, stateDrillCity, cityOfficialList]);

  const cityForOfficialList = scope === 'city' ? city : stateDrillCity;

  useEffect(() => {
    if (!cityForOfficialList) {
      setCityOfficialList(null);
      return;
    }
    const parsed = parseGeoFilterCity(cityForOfficialList);
    const staticList = getStaticOfficialNeighborhoods(parsed.city, parsed.state || cityStateCode);
    if (staticList && staticList.length > 0) {
      setCityOfficialList(staticList);
      return;
    }
    if (summary?.officialNeighborhoods && summary.officialNeighborhoods.length > 0 && scope === 'city') {
      setCityOfficialList(summary.officialNeighborhoods);
      return;
    }
    let cancelled = false;
    void fetchOfficialNeighborhoods(cityForOfficialList)
      .then((list) => {
        if (!cancelled && list.length > 0) setCityOfficialList(list);
      })
      .catch(() => {
        if (!cancelled) setCityOfficialList(null);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, cityForOfficialList, cityStateCode, summary?.officialNeighborhoods]);

  const hasOfficialList = Boolean(officialNeighborhoods?.length) && (scope === 'city' || Boolean(stateDrillCity));
  const isBusy = loading || locationSaving || locationLoading;

  const isStateCityList = scope === 'state' && !stateDrillCity;
  const activeCityLabel = scope === 'city' ? city : stateDrillCity;
  const activeCityParsed = useMemo(
    () => (activeCityLabel ? parseGeoFilterCity(activeCityLabel) : parsedCity),
    [activeCityLabel, parsedCity]
  );
  const activeCityName = activeCityParsed.city || cityNameOnly;

  const scopeContacts = useMemo(() => {
    if (!mapActive) return [];
    if (scope === 'state' && stateCode) {
      return deferredContacts.filter((c) => matchesStateContact(c, stateCode));
    }
    return deferredContacts.filter((c) => matchesCity(c.city || '', city, c.state || ''));
  }, [deferredContacts, city, scope, stateCode, mapActive]);

  const listContacts = useMemo(() => {
    if (scope === 'state' && stateDrillCity) {
      return scopeContacts.filter((c) =>
        matchesCity(c.city || '', stateDrillCity, c.state || stateCode)
      );
    }
    return scopeContacts;
  }, [scopeContacts, scope, stateDrillCity, stateCode]);

  const tempsByContact = useMemo(() => {
    if (!mapActive) return {};
    return computeContactTemperatures(listContacts, deferredConversations);
  }, [listContacts, deferredConversations, mapActive]);

  const clusters = useMemo(() => {
    if (!summary) return [];
    if (scope === 'state' && stateDrillCity) {
      return filterClustersForScope(summary.clusters, stateDrillCity, 'city', stateCode, hasOfficialList);
    }
    if (scope === 'state') {
      return filterClustersForScope(summary.clusters, regionSearchValue, 'state', stateCode, hasOfficialList);
    }
    return filterClustersForScope(summary.clusters, city, 'city', stateCode, hasOfficialList);
  }, [summary, city, regionSearchValue, scope, stateCode, stateDrillCity, hasOfficialList]);

  const allRows = useMemo(() => {
    if (isStateCityList) {
      return buildCityRows({
        contacts: scopeContacts,
        stateCode,
        tempsByContact,
        clusters,
      });
    }
    const rowCity = scope === 'state' && stateDrillCity ? stateDrillCity : city;
    return buildNeighborhoodRows({
      contacts: listContacts,
      city: rowCity,
      scope: 'city',
      tempsByContact,
      clusters,
      officialNeighborhoods,
      filterState: stateCode || undefined,
    });
  }, [
    isStateCityList,
    scopeContacts,
    listContacts,
    stateCode,
    tempsByContact,
    clusters,
    scope,
    stateDrillCity,
    city,
    officialNeighborhoods,
  ]);

  const showAllNeighborhoods = hasOfficialList;

  const visibleRows = useMemo(
    () => allRows.filter((r) => rowMatchesTempFilter(r, tempFilter, showAllNeighborhoods)),
    [allRows, tempFilter, showAllNeighborhoods]
  );

  const regionTemps = useMemo(() => sumRegionTemps(allRows), [allRows]);
  const regionTotal = regionTemps.hot + regionTemps.warm + regionTemps.cold + regionTemps.new;
  const serverRegionTotal = summary?.stats?.filteredTotal ?? null;
  const displayRegionTotal = serverRegionTotal ?? regionTotal;
  const contactsHydrating = contactsHasMore || contactsLoadingMore;
  const nbWithData = allRows.filter((r) => r.count > 0).length;
  const nbTotalListed = allRows.length;

  const cadastroHealth = useMemo(() => {
    const n = scopeContacts.length;
    if (n === 0) return { withNeighborhoodPct: 0, withCoordsPct: 0 };
    let withNb = 0;
    let withCoords = 0;
    for (const c of scopeContacts) {
      if ((c.neighborhood || '').trim()) withNb++;
      if (c.latitude != null && c.longitude != null) withCoords++;
    }
    return {
      withNeighborhoodPct: Math.round((100 * withNb) / n),
      withCoordsPct: Math.round((100 * withCoords) / n),
    };
  }, [scopeContacts]);

  const regionLabel =
    scope === 'city' ? city : stateRegionLabel || (stateCode ? `Estado ${stateCode}` : city);

  const buildAtlasLaunch = useCallback(
    (neighborhood?: string): AtlasRegionLaunch => {
      const launchCity = stateDrillCity || activeCityLabel || city;
      const parsed = parseGeoFilterCity(launchCity);
      return {
        city: parsed.city || cityNameOnly || city,
        state: parsed.state || stateCode || undefined,
        neighborhood,
        tempFilter,
        scope: stateDrillCity ? 'city' : scope,
      };
    },
    [city, cityNameOnly, stateCode, tempFilter, scope, stateDrillCity, activeCityLabel]
  );

  const neighborhoodContacts = useMemo((): NeighborhoodContactRow[] => {
    if (!selectedRow || isStateCityList) return [];
    const nb = selectedRow.label;
    const pool = listContacts;
    const nbCityName = activeCityName;
    const nbStateCode = activeCityParsed.state || stateCode;
    return pool
      .filter((c) => {
        if (hasOfficialList) {
          const resolved = resolveContactNeighborhoodForCity(
            nbCityName,
            nbStateCode,
            c.neighborhood || '',
            officialNeighborhoods
          );
          return resolved === nb || matchesNeighborhood(c.neighborhood || '', nb);
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
  }, [selectedRow, listContacts, isStateCityList, tempsByContact, hasOfficialList, activeCityName, activeCityParsed.state, stateCode, officialNeighborhoods]);

  const contactPinsResult = useMemo(() => {
    if (!selectedRow || isStateCityList) return { pins: [], unmapped: 0 };
    const cityName = activeCityName || city;
    const pinState = activeCityParsed.state || stateCode;
    let fallbackCenter: { lat: number; lng: number } | null = null;
    if (selectedRow.lat != null && selectedRow.lng != null) {
      const fixed = fixBrazilCoord(selectedRow.lat, selectedRow.lng);
      if (isMapCoordValid(fixed.lat, fixed.lng)) fallbackCenter = fixed;
    }
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
      filterState: pinState,
      fallbackCenter,
    });
  }, [selectedRow, isStateCityList, neighborhoodContacts, nbGeo?.contactPins, city, activeCityName, activeCityParsed.state, stateCode]);

  const contactPins = contactPinsResult.pins;
  const unmappedCount = contactPinsResult.unmapped;

  const pinFilterCity = stateDrillCity
    ? activeCityName
    : scope === 'city'
      ? cityNameOnly || city
      : '';

  const scopeContactRows = useMemo((): NeighborhoodContactRow[] => {
    return listContacts.map((c) => ({
      id: c.id,
      name: c.name || 'Sem nome',
      phone: c.phone || '',
      neighborhood: c.neighborhood || '',
      zipCode: c.zipCode || '',
      street: c.street || '',
      number: c.number || '',
      city: c.city || '',
      state: c.state || '',
      temp: tempsByContact[c.id]?.temp || 'new',
      latitude: c.latitude,
      longitude: c.longitude,
      geocodePrecision: c.geocodePrecision,
    }));
  }, [listContacts, tempsByContact]);

  const allScopePinsResult = useMemo(() => {
    if (!mapActive) return { pins: [], unmapped: 0, totalBeforeCap: 0, capped: false };
    const built = buildContactPinsForScope({
      contacts: scopeContactRows,
      apiPins: scopeGeo?.contactPins || [],
      filterCity: pinFilterCity,
      filterState: stateCode,
      tempFilter,
    });
  const capped = capMapContactPins(built.pins);
    return {
      pins: capped.pins,
      unmapped: built.unmapped,
      totalBeforeCap: capped.totalBeforeCap,
      capped: capped.capped,
    };
  }, [mapActive, scopeContactRows, scopeGeo?.contactPins, pinFilterCity, stateCode, tempFilter]);

  const allScopePins = allScopePinsResult.pins;
  const allScopeUnmapped = allScopePinsResult.unmapped;
  const allScopePinsCapped = allScopePinsResult.capped;
  const allScopePinsTotal = allScopePinsResult.totalBeforeCap;

  const activePins = selectedRow ? contactPins : allScopePins;

  const selectedContact = useMemo(
    () => activePins.find((p) => p.id === selectedContactId) ?? null,
    [activePins, selectedContactId]
  );

  const clearDataLayers = useCallback(() => {
    dataLayerGroupRef.current?.clearLayers();
    layersRef.current = [];
  }, []);

  const handleRegionApply = useCallback(
    async (region: TerritoryRegionApply) => {
      setSelectedRow(null);
      setSelectedContactId(null);
      setStateDrillCity(null);
      setSummary(null);
      lastViewportKeyRef.current = '';
      clearDataLayers();

      if (region.mode === 'state') {
        setScope('state');
        setStateRegionLabel(region.label);
        return;
      }

      setScope('city');
      setStateRegionLabel(null);
      await applyCityLabel(region.label);
    },
    [applyCityLabel, clearDataLayers]
  );

  const handleScopeChange = (next: RegionScope) => {
    setScope(next);
    setSelectedRow(null);
    setSelectedContactId(null);
    setStateDrillCity(null);
    lastViewportKeyRef.current = '';
    if (next === 'state' && cityStateCode) {
      const uf = resolveBrazilStateCode(cityStateCode);
      if (uf) setStateRegionLabel(formatStateLabel(uf));
    }
    if (next === 'city') {
      setStateRegionLabel(null);
    }
  };

  const handleBackToStateCities = useCallback(() => {
    setStateDrillCity(null);
    setSelectedRow(null);
    setSelectedContactId(null);
    setNbGeo(null);
    lastViewportKeyRef.current = '';
  }, []);

  const handleSelectRow = useCallback(
    (row: NeighborhoodRow | null) => {
      if (row && isStateCityList) {
        setStateDrillCity(row.label);
        setSelectedRow(null);
        setSelectedContactId(null);
        setNbGeo(null);
        lastViewportKeyRef.current = '';
        return;
      }
      setSelectedRow(row);
      setSelectedContactId(null);
      lastViewportKeyRef.current = '';
    },
    [isStateCityList]
  );

  const handleSelectContact = useCallback((contactId: string) => {
    setSelectedContactId(contactId);
    const map = mapRef.current;
    const pin = activePins.find((p) => p.id === contactId);
    if (map && pin) {
      map.flyTo([pin.lat, pin.lng], Math.max(map.getZoom(), 15), { duration: 0.35 });
    }
  }, [activePins]);

  useEffect(() => {
    if (!mapActive || !containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: BLUMENAU_CENTER,
      zoom: BLUMENAU_ZOOM,
      zoomControl: true,
    });
    dataLayerGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      dataLayerGroupRef.current = null;
      tileLayerRef.current = null;
    };
  }, [mapActive]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapActive) return;

    const tileUrls: Record<MapTileId, string> = {
      voyager: MAP_TILE_VOYAGER,
      light: compact ? MAP_TILE_LIGHT : MAP_TILE_POSITRON,
      dark: MAP_TILE_DARK,
    };
    const url = compact ? MAP_TILE_LIGHT : tileUrls[mapTile];

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const tile = L.tileLayer(url, {
      attribution: compact ? '© OSM' : '© OSM © CARTO',
      subdomains: 'abcd',
      maxZoom: 20,
    });
    tile.addTo(map);
    tileLayerRef.current = tile;
  }, [compact, mapActive, mapTile]);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchLeadsGeoSummary({
        layer: isStateCityList ? 'city' : 'neighborhood',
        city: scope === 'city' ? city : stateDrillCity ?? undefined,
        state: scope === 'state' && stateCode ? stateCode : undefined,
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
  }, [city, scope, stateCode, isStateCityList, stateDrillCity]);

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
    if (!mapActive || !selectedRow || isStateCityList) {
      setNbGeo(null);
      return;
    }
    const rowCity = stateDrillCity || city;
    const cityName = activeCityName || city;
    const nbLabel = `${selectedRow.label} · ${cityName}`;
    let cancelled = false;
    setNbGeoLoading(true);
    void fetchLeadsGeoSummary({
      layer: 'neighborhood',
      city: rowCity,
      state: stateCode || undefined,
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
  }, [selectedRow?.key, city, stateDrillCity, mapActive, stateCode, activeCityName, isStateCityList]);

  useEffect(() => {
    if (!mapActive || selectedRow || (scope === 'state' && !stateDrillCity)) {
      setScopeGeo(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchLeadsGeoSummary({
        layer: 'neighborhood',
        city: scope === 'city' ? city : stateDrillCity ?? undefined,
        state: scope === 'state' && stateCode ? stateCode : undefined,
        light: false,
      })
        .then((data) => {
          if (!cancelled) setScopeGeo(data);
        })
        .catch(() => {
          if (!cancelled) setScopeGeo(null);
        });
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mapActive, selectedRow, city, scope, stateCode, stateDrillCity, isStateCityList]);

  const paintMap = useCallback(() => {
    const map = mapRef.current;
    const target = dataLayerGroupRef.current;
    if (!map || !target) return;
    clearDataLayers();

    const onSelectPin = (pin: MapContactPin) => {
      setSelectedContactId(pin.id);
      map.flyTo([pin.lat, pin.lng], Math.max(map.getZoom(), 15), { duration: 0.35 });
    };

    if (selectedRow) {
      if (contactPins.length > 0) {
        layersRef.current = paintContactPins(target, contactPins, selectedContactId, onSelectPin);

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

    const rowsForMap = visibleRows.filter(
      (r) => r.lat != null && r.lng != null && (r.count > 0 || showAllNeighborhoods)
    );
    const normalized = rowsForMap
      .map((r) => {
        const { lat, lng } = fixBrazilCoord(r.lat!, r.lng!);
        return isMapCoordValid(lat, lng) ? { ...r, lat, lng } : null;
      })
      .filter(Boolean) as NeighborhoodRow[];

    if (mapViewMode === 'contacts' && allScopePins.length > 0) {
      if (contactViz === 'heat') {
        layersRef.current = paintContactsHeat(target, allScopePins);
      } else {
        layersRef.current = paintContactPins(target, allScopePins, selectedContactId, onSelectPin);
      }

      const vpKey = `all|${city}|${scope}|${tempFilter}|${mapViewMode}|${contactViz}|${allScopePins.length}|${selectedContactId}`;
      if (vpKey !== lastViewportKeyRef.current) {
        lastViewportKeyRef.current = vpKey;
        flyToContactPins(map, allScopePins);
      }
      return;
    }

    const rowsWithLeads = normalized.filter((r) => r.count > 0);
    layersRef.current = paintNeighborhoodLayer(
      target,
      neighborhoodViz,
      rowsWithLeads,
      null,
      territoryViewMode,
      handleSelectRow,
      isStateCityList ? 'city' : 'neighborhood'
    );

    const vpKey = `nb|${city}|${scope}|${tempFilter}|${mapViewMode}|${neighborhoodViz}|${territoryViewMode}|${rowsWithLeads.length}`;
    if (vpKey !== lastViewportKeyRef.current) {
      lastViewportKeyRef.current = vpKey;
      if (rowsWithLeads.length > 0) {
        flyToNeighborhoodRows(map, rowsWithLeads);
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
    allScopePins,
    selectedContactId,
    city,
    scope,
    tempFilter,
    summary,
    blumenauFocus,
    showAllNeighborhoods,
    mapViewMode,
    neighborhoodViz,
    contactViz,
    territoryViewMode,
    clearDataLayers,
    handleSelectRow,
    isStateCityList,
  ]);

  useEffect(() => {
    paintMap();
  }, [paintMap]);

  const handleLaunchCampaign = useCallback(() => {
    launchAtlasCampaign(buildAtlasLaunch());
    onNavigate?.('campaigns');
  }, [buildAtlasLaunch, onNavigate]);

  const handleOpenContacts = useCallback(() => {
    saveAtlasContactsHint(buildAtlasLaunch());
    onNavigate?.('contacts');
  }, [buildAtlasLaunch, onNavigate]);

  const handleLaunchCampaignForNeighborhood = useCallback(
    (row: NeighborhoodRow) => {
      launchAtlasCampaign(buildAtlasLaunch(row.label));
      onNavigate?.('campaigns');
    },
    [buildAtlasLaunch, onNavigate]
  );

  const handleOpenContactsForNeighborhood = useCallback(
    (row: NeighborhoodRow) => {
      saveAtlasContactsHint(buildAtlasLaunch(row.label));
      onNavigate?.('contacts');
    },
    [buildAtlasLaunch, onNavigate]
  );

  const fitMapToContent = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    lastViewportKeyRef.current = '';
    if (selectedRow && contactPins.length > 0) {
      flyToContactPins(map, contactPins);
      return;
    }
    if (mapViewMode === 'contacts' && allScopePins.length > 0) {
      flyToContactPins(map, allScopePins);
      return;
    }
    const rows = visibleRows.filter((r) => r.lat != null && r.lng != null && r.count > 0);
    if (rows.length > 0) {
      flyToNeighborhoodRows(map, rows);
    } else if (summary?.mapViewport) {
      map.setView([summary.mapViewport.lat, summary.mapViewport.lng], summary.mapViewport.zoom, {
        animate: true,
      });
    } else if (blumenauFocus) {
      map.setView(BLUMENAU_CENTER, BLUMENAU_ZOOM, { animate: true });
    }
  }, [
    selectedRow,
    contactPins,
    allScopePins,
    mapViewMode,
    visibleRows,
    summary,
    blumenauFocus,
  ]);

  const recenterMap = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    lastViewportKeyRef.current = '';
    if (summary?.mapViewport) {
      map.flyTo([summary.mapViewport.lat, summary.mapViewport.lng], summary.mapViewport.zoom, {
        duration: 0.45,
      });
    } else if (blumenauFocus) {
      map.flyTo(BLUMENAU_CENTER, BLUMENAU_ZOOM, { duration: 0.45 });
    } else {
      fitMapToContent();
    }
  }, [summary, blumenauFocus, fitMapToContent]);

  const mapStatsLine = useMemo(() => {
    if (selectedRow) {
      return `${selectedRow.label} · ${contactPins.length.toLocaleString('pt-BR')} no mapa${
        unmappedCount > 0 ? ` · ${unmappedCount} sem coordenada` : ''
      }`;
    }
    if (mapViewMode === 'contacts') {
      if (allScopePins.length === 0) {
        return 'Poucos contatos com coordenada nesta visão';
      }
      const mode = contactViz === 'heat' ? 'mapa de densidade' : 'pins individuais';
      return `${allScopePins.length.toLocaleString('pt-BR')} contatos · ${mode}${
        allScopePinsCapped
          ? ` · amostra de ${allScopePinsTotal.toLocaleString('pt-BR')}`
          : ''
      }`;
    }
    const entity = isStateCityList ? 'cidades' : 'bairros';
    const vizLabel =
      neighborhoodViz === 'heat' ? 'calor territorial' : neighborhoodViz === 'bubbles' ? 'bolhas' : 'rótulos';
    return `${nbWithData} ${entity} · ${vizLabel} · colorido por ${
      territoryViewMode === 'temperature' ? 'temperatura' : 'volume'
    }`;
  }, [
    selectedRow,
    contactPins.length,
    unmappedCount,
    mapViewMode,
    allScopePins.length,
    contactViz,
    allScopePinsCapped,
    allScopePinsTotal,
    nbWithData,
    neighborhoodViz,
    territoryViewMode,
    isStateCityList,
  ]);

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
        <TerritoryCitySearch
          value={regionSearchValue}
          mode={scope}
          onApply={handleRegionApply}
          saving={locationSaving}
        />
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
            {stateDrillCity ? (
              <>
                {stateDrillCity} · {nbTotalListed} bairros
                {nbWithData < nbTotalListed ? ` (${nbWithData} com contatos)` : ''}
              </>
            ) : (
              <>
                {regionLabel} · {nbTotalListed}{' '}
                {isStateCityList ? 'cidades' : scope === 'state' ? 'bairros no estado' : 'bairros'}
                {nbWithData < nbTotalListed ? ` (${nbWithData} com contatos)` : ''}
              </>
            )}
            {' · '}
            {displayRegionTotal.toLocaleString('pt-BR')} contatos na região
          </p>
        </div>
        <div className="zm-atlas__tools">
          <TerritoryCitySearch
            value={regionSearchValue}
            mode={scope}
            onApply={handleRegionApply}
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
        </div>
      </header>

      <TerritoryAtlasMeta
        regionLabel={regionLabel}
        regionTotal={regionTotal}
        serverRegionTotal={serverRegionTotal}
        globalContactsLoaded={contacts.length}
        globalContactsTotal={contactsSavedTotal}
        contactsHydrating={contactsHydrating}
        scopeContactCount={scopeContacts.length}
        withNeighborhoodPct={cadastroHealth.withNeighborhoodPct}
        withCoordsPct={cadastroHealth.withCoordsPct}
        onLaunchCampaign={handleLaunchCampaign}
        onOpenContacts={handleOpenContacts}
      />

      <TerritoryTempRiver
        totals={regionTemps}
        activeFilter={tempFilter}
        onFilterChange={setTempFilter}
        regionTotalLabel={displayRegionTotal}
        contactsHydrating={contactsHydrating}
      />

      <div className="zm-atlas__split">
        <div className="zm-atlas__map-col">
          <TerritoryMapChrome
            mapViewMode={mapViewMode}
            onMapViewModeChange={(mode) => {
              setMapViewMode(mode);
              lastViewportKeyRef.current = '';
            }}
            neighborhoodViz={neighborhoodViz}
            onNeighborhoodVizChange={(viz) => {
              setNeighborhoodViz(viz);
              lastViewportKeyRef.current = '';
            }}
            contactViz={contactViz}
            onContactVizChange={(viz) => {
              setContactViz(viz);
              lastViewportKeyRef.current = '';
            }}
            territoryViewMode={territoryViewMode}
            onTerritoryViewModeChange={(mode) => {
              setTerritoryViewMode(mode);
              lastViewportKeyRef.current = '';
            }}
            mapTile={mapTile}
            onMapTileChange={setMapTile}
            onFitBounds={fitMapToContent}
            onRecenter={recenterMap}
            focusMode={Boolean(selectedRow)}
            neighborhoodsModeLabel={isStateCityList ? 'Cidades' : 'Bairros'}
            statsLine={mapStatsLine}
          />
          <div className="zm-atlas__map-wrap zm-atlas__map-wrap--compact zm-territory-map--pro zm-territory-map__frame">
            <div ref={containerRef} className="zm-atlas__map" />
            {(isBusy || !summary) && mapActive && (
              <div className="zm-atlas__map-loading">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            )}
            {!mapActive && deferLoad && (
              <div className="zm-atlas__map-loading">Role para carregar</div>
            )}
            {nbGeoLoading && selectedRow && (
              <div className="zm-atlas__map-sync-badge">
                <Loader2 className="w-3 h-3 animate-spin" />
                Sincronizando pins…
              </div>
            )}
            {selectedContact && (
              <TerritoryContactCard contact={selectedContact} onClose={() => setSelectedContactId(null)} />
            )}
          </div>
        </div>

        <TerritoryRankingTable
          rows={visibleRows}
          selectedKey={selectedRow?.key ?? null}
          selectedContactId={selectedContactId}
          contacts={neighborhoodContacts}
          entityLabel={isStateCityList ? 'Cidade' : 'Bairro'}
          emptyLabel={
            isStateCityList
              ? 'Nenhuma cidade com contatos neste estado.'
              : 'Nenhum bairro nesta região.'
          }
          onBack={stateDrillCity ? handleBackToStateCities : undefined}
          backLabel="Voltar às cidades do estado"
          onSelectRow={handleSelectRow}
          onSelectContact={handleSelectContact}
          onExportCsv={handleExportCsv}
          onLaunchCampaignForNeighborhood={handleLaunchCampaignForNeighborhood}
          onOpenContactsForNeighborhood={handleOpenContactsForNeighborhood}
        />
      </div>
    </div>
  );
};
