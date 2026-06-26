/**
 * Atlas territorial — compacto, colorido, pins por bairro + ficha do contato.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Loader2, Map, BarChart3, Target, Compass, Search, MessageSquare, Send, Users, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Contact, Conversation } from '../../types';
import { useZapMassCore } from '../../context/ZapMassContext';
import { AiSparkButton } from '../ai/AiSparkButton';
import { useAiStatus } from '../../hooks/useAiStatus';
import { aiMapDataQuality } from '../../services/aiApi';
import { DDD_COORDINATES, getDddCoordinates } from '../../utils/dddCoordinates';
import {
  fetchLeadsGeoSummary,
  fetchMunicipiosGeoJson,
  fetchOfficialNeighborhoods,
  type LeadsGeoSummary,
  type MunicipiosGeoJson,
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
import { loadMunicipioCoords, type MunicipioCoordsIndex } from '../../utils/municipioCoords';
import { spreadOverlappingMarkers } from '../../utils/mapMarkerLayout';
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
  computeStateMunicipalityCoverage,
  formatMunicipalityCoverageLine,
} from './territory/stateMunicipalityCoverage';
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
  paintMunicipalityBorders,
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
  /** `page`: aba dedicada em tela cheia; `embedded`: card no painel (legado). */
  variant?: 'embedded' | 'page';
  deferLoad?: boolean;
  contactsSavedTotal?: number | null;
  contactsHasMore?: boolean;
  contactsLoadingMore?: boolean;
  onNavigate?: (view: string) => void;
};

export const TerritoryLeadsMap: React.FC<Props> = ({
  contacts,
  conversations,
  defaultCity = 'Blumenau · SC',
  compact = false,
  variant = 'embedded',
  deferLoad = false,
  contactsSavedTotal = null,
  contactsHasMore = false,
  contactsLoadingMore = false,
  onNavigate,
}) => {
  const { bulkUpdateContacts } = useZapMassCore();
  const { configured: aiConfigured } = useAiStatus();
  const [aiMapLoading, setAiMapLoading] = useState(false);
  const [aiMapResult, setAiMapResult] = useState<{
    summary: string;
    tips: string[];
    fixes: Array<{ id: string; neighborhood?: string; city?: string; state?: string; note?: string }>;
  } | null>(null);
  const isPage = variant === 'page';
  const shouldDeferLoad = deferLoad && !isPage;
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
  const [mapActive, setMapActive] = useState(!shouldDeferLoad);
  const [cityOfficialList, setCityOfficialList] = useState<string[] | null>(null);
  const [stateRegionLabel, setStateRegionLabel] = useState<string | null>(null);
  const [stateDrillCity, setStateDrillCity] = useState<string | null>(null);
  const [mapViewMode, setMapViewMode] = useState<MapViewMode>('neighborhoods');
  const [neighborhoodViz, setNeighborhoodViz] = useState<NeighborhoodViz>('heat');
  const [contactViz, setContactViz] = useState<ContactViz>('heat');
  const [territoryViewMode, setTerritoryViewMode] = useState<TerritoryViewMode>('temperature');
  const [mapTile, setMapTile] = useState<MapTileId>('voyager');
  const [municipioCoords, setMunicipioCoords] = useState<MunicipioCoordsIndex | null>(null);
  const [municipiosGeo, setMunicipiosGeo] = useState<MunicipiosGeoJson | null>(null);
  const [municipiosGeoLoading, setMunicipiosGeoLoading] = useState(false);
  const [showMuniOutline, setShowMuniOutline] = useState(true);
  const [activeTab, setActiveTab] = useState<'map' | 'analytics'>('map');
  const [dddSearch, setDddSearch] = useState('');

  const deferredContacts = useDeferredValue(contacts);
  const deferredConversations = useDeferredValue(conversations);

  useEffect(() => {
    if (!mapActive) return;
    let cancelled = false;
    void loadMunicipioCoords().then((idx) => {
      if (!cancelled) setMunicipioCoords(idx);
    });
    return () => {
      cancelled = true;
    };
  }, [mapActive]);

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

  useEffect(() => {
    if (!mapActive || !isStateCityList || !stateCode) {
      setMunicipiosGeo(null);
      setMunicipiosGeoLoading(false);
      return;
    }
    let cancelled = false;
    setMunicipiosGeoLoading(true);
    void fetchMunicipiosGeoJson(stateCode)
      .then((geo) => {
        if (!cancelled) setMunicipiosGeo(geo);
      })
      .catch(() => {
        if (!cancelled) setMunicipiosGeo(null);
      })
      .finally(() => {
        if (!cancelled) setMunicipiosGeoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mapActive, isStateCityList, stateCode]);

  useEffect(() => {
    if (!isStateCityList) return;
    if (neighborhoodViz === 'borders') {
      setNeighborhoodViz('bubbles');
      setShowMuniOutline(true);
    }
  }, [isStateCityList, neighborhoodViz]);

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

  // Agrupa e calcula as estatisticas por DDD em tempo real para o Painel Analitico
  const dddAnalytics = useMemo(() => {
    const groups: Record<string, { ddd: string; city: string; state: string; count: number; hot: number; warm: number; cold: number; newCount: number }> = {};
    contacts.forEach((c) => {
      const clean = c.phone ? c.phone.replace(/\D/g, '') : '';
      let ddd = '';
      if (clean.startsWith('55') && clean.length >= 12) {
        ddd = clean.slice(2, 4);
      } else if (clean.length >= 10) {
        ddd = clean.slice(0, 2);
      }
      if (!ddd) return;

      const dddInfo = DDD_COORDINATES[ddd] || { city: 'Desconhecido', state: 'BR' };
      if (!groups[ddd]) {
        groups[ddd] = {
          ddd,
          city: dddInfo.city,
          state: dddInfo.state,
          count: 0,
          hot: 0,
          warm: 0,
          cold: 0,
          newCount: 0
        };
      }
      
      const tempStats = tempsByContact[c.id];
      const temp = tempStats ? tempStats.temp : 'new';
      groups[ddd].count++;
      if (temp === 'hot') groups[ddd].hot++;
      else if (temp === 'warm') groups[ddd].warm++;
      else if (temp === 'cold') groups[ddd].cold++;
      else groups[ddd].newCount++;
    });

    return Object.values(groups).sort((a, b) => b.count - a.count);
  }, [contacts, tempsByContact]);

  // Agrupa e calcula as estatisticas por Estado (UF) em tempo real para o Painel Analitico
  const stateAnalytics = useMemo(() => {
    const groups: Record<string, { state: string; count: number; hot: number; warm: number; cold: number; newCount: number }> = {};
    contacts.forEach((c) => {
      const clean = c.phone ? c.phone.replace(/\D/g, '') : '';
      let ddd = '';
      if (clean.startsWith('55') && clean.length >= 12) {
        ddd = clean.slice(2, 4);
      } else if (clean.length >= 10) {
        ddd = clean.slice(0, 2);
      }
      let state = 'Outros';
      if (ddd && DDD_COORDINATES[ddd]) {
        state = DDD_COORDINATES[ddd].state;
      } else if (c.state) {
        state = c.state.toUpperCase().trim().slice(0, 2);
      }
      
      if (!groups[state]) {
        groups[state] = {
          state,
          count: 0,
          hot: 0,
          warm: 0,
          cold: 0,
          newCount: 0
        };
      }

      const tempStats = tempsByContact[c.id];
      const temp = tempStats ? tempStats.temp : 'new';
      groups[state].count++;
      if (temp === 'hot') groups[state].hot++;
      else if (temp === 'warm') groups[state].warm++;
      else if (temp === 'cold') groups[state].cold++;
      else groups[state].newCount++;
    });

    return Object.values(groups).sort((a, b) => b.count - a.count);
  }, [contacts, tempsByContact]);

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
        coordsIndex: municipioCoords,
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
    municipioCoords,
    municipiosGeo,
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

  const municipalityCoverage = useMemo(() => {
    if (!isStateCityList || !stateCode) return null;
    return computeStateMunicipalityCoverage(stateCode, allRows, municipioCoords);
  }, [isStateCityList, stateCode, allRows, municipioCoords]);

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

  const incompleteGeoSamples = useMemo(
    () =>
      scopeContacts
        .filter((c) => !(c.neighborhood || '').trim() || !(c.city || '').trim() || !(c.state || '').trim())
        .slice(0, 30)
        .map((c) => ({
          id: c.id,
          name: c.name,
          city: c.city,
          state: c.state,
          neighborhood: c.neighborhood,
          phone: c.phone,
        })),
    [scopeContacts]
  );

  const runAiMapQuality = useCallback(async () => {
    if (!aiConfigured || aiMapLoading) return;
    if (incompleteGeoSamples.length === 0) {
      toast('Nesta região, os contatos já têm bairro, cidade e UF preenchidos.', { icon: '✓' });
      return;
    }
    setAiMapLoading(true);
    setAiMapResult(null);
    try {
      const res = await aiMapDataQuality(regionLabel, incompleteGeoSamples);
      if (!res.ok) throw new Error(res.error || 'Falha na IA');
      setAiMapResult({ summary: res.summary, tips: res.tips, fixes: res.fixes });
      if (!res.fixes.length) {
        toast('IA analisou a região mas não sugeriu correções automáticas.', { icon: 'ℹ️' });
      } else {
        toast.success(`IA sugeriu correções para ${res.fixes.length} contato(s).`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na IA.');
    } finally {
      setAiMapLoading(false);
    }
  }, [aiConfigured, aiMapLoading, incompleteGeoSamples, regionLabel]);

  const applyAiMapFixes = useCallback(async () => {
    if (!aiMapResult?.fixes.length) return;
    const items = aiMapResult.fixes
      .map((fix) => {
        const c = contacts.find((x) => x.id === fix.id);
        if (!c) return null;
        const updates: Partial<Contact> = {};
        if (fix.neighborhood?.trim() && !(c.neighborhood || '').trim()) updates.neighborhood = fix.neighborhood.trim();
        if (fix.city?.trim() && !(c.city || '').trim()) updates.city = fix.city.trim();
        if (fix.state?.trim() && !(c.state || '').trim()) updates.state = fix.state.trim().toUpperCase().slice(0, 2);
        if (Object.keys(updates).length === 0) return null;
        return { id: fix.id, updates };
      })
      .filter((x): x is { id: string; updates: Partial<Contact> } => x !== null);
    if (items.length === 0) {
      toast('Nenhuma correção aplicável — os campos já estão preenchidos.', { icon: 'ℹ️' });
      return;
    }
    await bulkUpdateContacts(items, { silent: true });
    toast.success(`Correções da IA aplicadas em ${items.length} contato(s).`);
    setAiMapResult(null);
  }, [aiMapResult, contacts, bulkUpdateContacts]);

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
    if (!shouldDeferLoad || mapActive || !rootRef.current) return;
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
  }, [shouldDeferLoad, mapActive]);

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
    let mapRows = rowsWithLeads;

    if (isStateCityList && neighborhoodViz === 'bubbles' && mapRows.length > 80) {
      mapRows = mapRows.slice(0, 80);
    }

    if (neighborhoodViz === 'bubbles' && mapRows.length > 18) {
      mapRows = spreadOverlappingMarkers(
        mapRows.map((r) => ({ ...r, key: r.key, count: r.count }))
      );
    }

    const vizMode = neighborhoodViz === 'borders' ? 'bubbles' : neighborhoodViz;
    const allLayers: L.Layer[] = [];

    if (isStateCityList && showMuniOutline && municipiosGeo?.features?.length) {
      allLayers.push(
        ...paintMunicipalityBorders(
          target,
          municipiosGeo,
          mapRows,
          territoryViewMode,
          handleSelectRow,
          { overlay: true }
        )
      );
    }

    allLayers.push(
      ...paintNeighborhoodLayer(
        target,
        vizMode,
        mapRows,
        null,
        territoryViewMode,
        handleSelectRow,
        isStateCityList ? 'city' : 'neighborhood',
        { municipiosGeo: isStateCityList ? municipiosGeo : null }
      )
    );

    layersRef.current = allLayers;

    const vpKey = `nb|${city}|${scope}|${tempFilter}|${mapViewMode}|${vizMode}|${showMuniOutline}|${territoryViewMode}|${mapRows.length}|${municipiosGeo?.features?.length ?? 0}`;
    if (vpKey !== lastViewportKeyRef.current) {
      lastViewportKeyRef.current = vpKey;
      if (isStateCityList && showMuniOutline && municipiosGeo?.features?.length) {
        const borderLayer = allLayers.find((l) => l instanceof L.GeoJSON) as L.GeoJSON | undefined;
        if (borderLayer) {
          map.fitBounds(borderLayer.getBounds(), { padding: [24, 24], maxZoom: 9 });
        }
      } else if (mapRows.length > 0) {
        flyToNeighborhoodRows(map, mapRows);
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
    municipiosGeo,
    showMuniOutline,
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

  const handleLaunchCampaignForDdd = useCallback((ddd: string) => {
    launchAtlasCampaign({
      city: '',
      state: '',
      scope: 'ddd',
      ddd,
      tempFilter: 'all'
    });
    toast.success(`Rascunho de campanha para o DDD ${ddd} preparado!`);
    onNavigate?.('campaigns');
  }, [onNavigate]);

  const handleOpenContactsForDdd = useCallback((ddd: string) => {
    saveAtlasContactsHint({
      city: '',
      state: '',
      scope: 'ddd',
      ddd,
      tempFilter: 'all'
    });
    onNavigate?.('contacts');
  }, [onNavigate]);

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
    const entity = isStateCityList ? 'cidades com contatos' : 'bairros';
    const vizMode = neighborhoodViz === 'borders' ? 'bubbles' : neighborhoodViz;
    const vizLabel =
      vizMode === 'heat'
        ? 'calor territorial'
        : vizMode === 'bubbles'
          ? 'bolhas'
          : 'rótulos';
    const capped =
      isStateCityList && vizMode === 'bubbles' && nbWithData > 80
        ? ` · top 80 de ${nbWithData}`
        : '';
    const geoHint =
      isStateCityList && showMuniOutline && municipiosGeoLoading
        ? ' · carregando contornos…'
        : isStateCityList && showMuniOutline
          ? ' · contornos IBGE'
          : '';
    const muniHint =
      isStateCityList && municipalityCoverage
        ? ` · ${formatMunicipalityCoverageLine(municipalityCoverage)}`
        : '';
    return `${nbWithData} ${entity}${muniHint} · ${vizLabel}${capped}${geoHint} · colorido por ${
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
    municipiosGeoLoading,
    showMuniOutline,
    municipalityCoverage,
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
    <div ref={rootRef} className={`zm-atlas zm-atlas--v2${isPage ? ' zm-atlas--page' : ''}`}>
      <header className="zm-atlas__header zm-atlas__header--compact">
        <div className="zm-atlas__header-text">
          {!isPage && <h2 className="zm-atlas__title">Atlas territorial</h2>}
          <p className={`zm-atlas__subtitle${isPage ? ' zm-atlas__subtitle--page' : ''}`}>
            {stateDrillCity ? (
              <>
                {stateDrillCity} · {nbTotalListed} bairros
                {nbWithData < nbTotalListed ? ` (${nbWithData} com contatos)` : ''}
              </>
            ) : (
              <>
                {regionLabel}
                {isStateCityList && municipalityCoverage ? (
                  <>
                    {' · '}
                    {municipalityCoverage.withContacts.toLocaleString('pt-BR')} municípios com contatos
                    {' · '}
                    {municipalityCoverage.withoutContacts.toLocaleString('pt-BR')} sem contatos
                    {' · '}
                    {municipalityCoverage.total.toLocaleString('pt-BR')} no estado
                  </>
                ) : (
                  <>
                    {' · '}
                    {nbTotalListed} {isStateCityList ? 'cidades' : scope === 'state' ? 'bairros no estado' : 'bairros'}
                    {nbWithData < nbTotalListed ? ` (${nbWithData} com contatos)` : ''}
                  </>
                )}
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
        municipalityCoverage={isStateCityList ? municipalityCoverage : null}
        onLaunchCampaign={handleLaunchCampaign}
        onOpenContacts={handleOpenContacts}
      />

      {aiConfigured && incompleteGeoSamples.length > 0 && (
        <div className="zm-ai-map-banner">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <b>{incompleteGeoSamples.length}</b> contato(s) com bairro/cidade/UF incompletos em{' '}
              <b>{regionLabel}</b>.
            </span>
            <AiSparkButton
              label="IA corrigir dados"
              loading={aiMapLoading}
              disabled={aiMapLoading}
              onClick={() => void runAiMapQuality()}
              title="Gemini sugere bairro e localização plausíveis para a região"
            />
          </div>
          {aiMapResult && (
            <div className="mt-2 space-y-2">
              {aiMapResult.summary && <p>{aiMapResult.summary}</p>}
              {aiMapResult.tips.length > 0 && (
                <ul>
                  {aiMapResult.tips.slice(0, 3).map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
              {aiMapResult.fixes.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    className="zm-ai-ask-panel__send"
                    onClick={() => void applyAiMapFixes()}
                  >
                    Aplicar {aiMapResult.fixes.length} correção(ões)
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-slate-500 underline"
                    onClick={() => setAiMapResult(null)}
                  >
                    Descartar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <TerritoryTempRiver
        totals={regionTemps}
        activeFilter={tempFilter}
        onFilterChange={setTempFilter}
        regionTotalLabel={displayRegionTotal}
        contactsHydrating={contactsHydrating}
        municipalityCoverage={isStateCityList ? municipalityCoverage : null}
      />

      {/* SELETOR DE VISUALIZAÇÃO ULTRA PREMIUM */}
      <div className="flex border-b border-slate-200/10 dark:border-slate-800/80 pb-2 mb-2 justify-between items-center flex-wrap gap-4">
        <div className="flex space-x-2">
          <button
            type="button"
            className={`flex items-center space-x-2 py-2 px-4 rounded-xl text-xs font-bold transition-all duration-300 ${
              activeTab === 'map'
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
            }`}
            onClick={() => {
              setActiveTab('map');
              setMapActive(true);
            }}
          >
            <Map className="w-3.5 h-3.5" />
            <span>🗺️ Visão de Mapa (Geográfico & DDDs)</span>
          </button>
          <button
            type="button"
            className={`flex items-center space-x-2 py-2 px-4 rounded-xl text-xs font-bold transition-all duration-300 ${
              activeTab === 'analytics'
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
            }`}
            onClick={() => setActiveTab('analytics')}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>📊 Análise e Demografia Nacional por DDD</span>
          </button>
        </div>
        
        <div className="text-[11px] text-slate-400 flex items-center space-x-2">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="font-semibold text-slate-300">100% dos leads mapeados nacionalmente</span>
        </div>
      </div>

      {activeTab === 'analytics' ? (
        <div className="space-y-6 animate-fade-in py-2">
          {/* BARRA DE PESQUISA & RESUMOS */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-center">
            <div className="lg:col-span-2 relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Pesquisar por DDD, Cidade ou Estado..."
                className="w-full bg-slate-950/60 border border-slate-800/60 rounded-xl py-2 pl-9 pr-4 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-100"
                value={dddSearch}
                onChange={(e) => setDddSearch(e.target.value)}
              />
            </div>
            
            <div className="bg-slate-900/25 border border-slate-800/60 rounded-xl p-3 flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Target className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[9.5px] text-slate-500 font-bold uppercase tracking-wider">DDDs Ativos</p>
                <p className="text-xs font-bold text-white">{dddAnalytics.length} regiões</p>
              </div>
            </div>

            <div className="bg-slate-900/25 border border-slate-800/60 rounded-xl p-3 flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                <Compass className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[9.5px] text-slate-500 font-bold uppercase tracking-wider">Estados Cobertos</p>
                <p className="text-xs font-bold text-white">{stateAnalytics.length} UFs</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
            {/* GRID DE DDD CARDS (ESQUERDA - 2 COLUNAS) */}
            <div className="xl:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-2">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Distribuição Geográfica por DDD ({dddAnalytics.filter(item => {
                    const term = dddSearch.toLowerCase().trim();
                    return !term || item.ddd.includes(term) || item.city.toLowerCase().includes(term) || item.state.toLowerCase().includes(term);
                  }).length})</span>
                </h3>
              </div>

              {dddAnalytics.filter(item => {
                const term = dddSearch.toLowerCase().trim();
                return !term || item.ddd.includes(term) || item.city.toLowerCase().includes(term) || item.state.toLowerCase().includes(term);
              }).length === 0 ? (
                <div className="bg-slate-900/20 border border-slate-800/40 rounded-xl p-8 text-center text-slate-500 text-xs">
                  Nenhum DDD encontrado com os critérios de busca digitados.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto pr-1">
                  {dddAnalytics.filter(item => {
                    const term = dddSearch.toLowerCase().trim();
                    return !term || item.ddd.includes(term) || item.city.toLowerCase().includes(term) || item.state.toLowerCase().includes(term);
                  }).map((item) => {
                    const hotPct = Math.round((100 * item.hot) / item.count) || 0;
                    const warmPct = Math.round((100 * item.warm) / item.count) || 0;
                    const coldPct = Math.round((100 * item.cold) / item.count) || 0;
                    const newPct = Math.round((100 * item.newCount) / item.count) || 0;

                    return (
                      <div
                        key={item.ddd}
                        className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between hover:border-emerald-500/30 transition-all duration-300 hover:shadow-[0_0_20px_rgba(16,185,129,0.05)] group"
                      >
                        <div>
                          {/* Top Card */}
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center space-x-2">
                                <span className="bg-emerald-500/10 text-emerald-400 text-xs font-extrabold px-2 py-0.5 rounded">
                                  DDD {item.ddd}
                                </span>
                                <span className="text-slate-200 text-xs font-bold">
                                  {item.city} · {item.state}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 mt-1">
                                {item.count.toLocaleString('pt-BR')} contatos ativos
                              </p>
                            </div>
                            
                            <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/5 px-2 py-0.5 rounded-full border border-emerald-500/10">
                              {hotPct}% Quentes
                            </span>
                          </div>

                          {/* Mini Barra Stacked de Temperaturas */}
                          <div className="mt-4 space-y-1.5">
                            <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-slate-800">
                              <div style={{ width: `${hotPct}%` }} className="bg-emerald-500" title={`Quentes: ${item.hot}`} />
                              <div style={{ width: `${warmPct}%` }} className="bg-amber-500" title={`Mornos: ${item.warm}`} />
                              <div style={{ width: `${coldPct}%` }} className="bg-sky-500" title={`Frios: ${item.cold}`} />
                              <div style={{ width: `${newPct}%` }} className="bg-slate-500" title={`Novos: ${item.newCount}`} />
                            </div>
                            
                            <div className="flex items-center justify-between text-[10px] text-slate-500 font-semibold">
                              <span className="text-emerald-400/90 flex items-center space-x-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block mr-1" />
                                {item.hot} Quentes
                              </span>
                              <span className="text-amber-400/90 flex items-center space-x-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block mr-1" />
                                {item.warm} Mornos
                              </span>
                              <span className="text-sky-400/90 flex items-center space-x-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-sky-500 inline-block mr-1" />
                                {item.count - item.hot - item.warm} Outros
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Ações Rápidas */}
                        <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            className="text-[10.5px] font-bold text-slate-400 hover:text-white flex items-center space-x-1 bg-slate-800/40 hover:bg-slate-800/80 px-2.5 py-1.5 rounded-lg border border-slate-800/80 transition-all"
                            onClick={() => handleOpenContactsForDdd(item.ddd)}
                          >
                            <Users className="w-3 h-3" />
                            <span>Ver Contatos</span>
                          </button>
                          
                          <button
                            type="button"
                            className="text-[10.5px] font-bold text-emerald-400 hover:text-white flex items-center space-x-1 bg-emerald-500/5 hover:bg-emerald-500 px-2.5 py-1.5 rounded-lg border border-emerald-500/10 hover:border-emerald-500 transition-all"
                            onClick={() => handleLaunchCampaignForDdd(item.ddd)}
                          >
                            <Send className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                            <span>Lançar Campanha</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* RANKING DE ESTADOS (UFs) - DIREITA */}
            <div className="space-y-4 bg-slate-900/20 border border-slate-800/60 rounded-xl p-4 max-h-[660px] overflow-y-auto">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-2">
                <Target className="w-3.5 h-3.5 text-emerald-400" />
                <span>🇧🇷 Ranking de Estados (UFs)</span>
              </h3>
              
              <div className="space-y-3 pt-2">
                {stateAnalytics.map((item, idx) => {
                  const maxCount = stateAnalytics[0]?.count || 1;
                  const pctWidth = Math.round((100 * item.count) / maxCount);
                  const totalContacts = contacts.length || 1;
                  const pctOfGlobal = Math.round((100 * item.count) / totalContacts) || 1;

                  return (
                    <div key={item.state} className="space-y-1">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <div className="flex items-center space-x-2">
                          <span className="text-slate-500 text-[10px]">#{idx + 1}</span>
                          <span className="text-slate-200">{item.state}</span>
                        </div>
                        <span className="text-slate-400 text-[11px]">
                          {item.count.toLocaleString('pt-BR')} ({pctOfGlobal}%)
                        </span>
                      </div>
                      
                      <div className="relative h-2 w-full bg-slate-800/60 rounded-full overflow-hidden">
                        <div
                          style={{ width: `${pctWidth}%` }}
                          className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                        />
                      </div>
                      
                      <div className="flex items-center space-x-3 text-[9px] text-slate-500 font-bold pl-5">
                        <span className="text-emerald-500">{item.hot} 🔥</span>
                        <span className="text-amber-500">{item.warm} ⚡</span>
                        <span className="text-sky-500">{item.cold} ❄️</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
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
              showMunicipioBorders={isStateCityList}
              showMuniOutline={showMuniOutline}
              onShowMuniOutlineChange={(on) => {
                setShowMuniOutline(on);
                lastViewportKeyRef.current = '';
              }}
              statsLine={mapStatsLine}
            />
            <div className="zm-atlas__map-wrap zm-atlas__map-wrap--compact zm-territory-map--pro zm-territory-map__frame">
              <div ref={containerRef} className="zm-atlas__map" />
              {(isBusy || !summary) && mapActive && (
                <div className="zm-atlas__map-loading">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              )}
              {!mapActive && shouldDeferLoad && (
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
      )}
    </div>
  );
};
