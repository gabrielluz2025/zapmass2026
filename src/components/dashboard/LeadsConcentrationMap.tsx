import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flame, Loader2, MapPin, RefreshCw, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, Select } from '../ui';
import {
  apiGeocodeLeadsClusters,
  fetchLeadsGeoConfig,
  fetchLeadsGeoSummary,
  type GeoCluster,
  type GeoLayer,
  type LeadsGeoQuery,
  type LeadsGeoSummary
} from '../../services/leadsGeoApi';

type MapMode = 'heatmap' | 'circles';

type GoogleMapsNS = {
  maps: {
    Map: new (el: HTMLElement, opts: Record<string, unknown>) => {
      fitBounds: (b: unknown) => void;
      setCenter: (c: { lat: number; lng: number }) => void;
      setZoom: (z: number) => void;
    };
    LatLng: new (lat: number, lng: number) => unknown;
    LatLngBounds: new () => { extend: (p: unknown) => void };
    Circle: new (opts: Record<string, unknown>) => unknown;
    Marker: new (opts: Record<string, unknown>) => unknown;
    InfoWindow: new (opts?: Record<string, unknown>) => { open: (map: unknown, anchor?: unknown) => void };
    event: { addListener: (target: unknown, event: string, fn: () => void) => void };
    visualization: {
      HeatmapLayer: new (opts: Record<string, unknown>) => { setMap: (map: unknown | null) => void };
    };
  };
};

declare global {
  interface Window {
    google?: GoogleMapsNS;
  }
}

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

function loadGoogleMapsScript(apiKey: string): Promise<GoogleMapsNS> {
  return new Promise((resolve, reject) => {
    if (window.google?.maps?.visualization) return resolve(window.google);
    const id = 'zapmass-google-maps-js';
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    const onReady = () => {
      if (window.google?.maps) resolve(window.google);
      else reject(new Error('Google Maps não carregou.'));
    };
    if (existing) {
      existing.addEventListener('load', onReady);
      if (window.google?.maps) onReady();
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&language=pt-BR&region=BR&libraries=visualization`;
    script.onload = onReady;
    script.onerror = () => reject(new Error('Falha ao carregar Google Maps.'));
    document.head.appendChild(script);
  });
}

function circleRadiusMeters(count: number): number {
  return Math.min(80_000, Math.max(6_000, Math.sqrt(count) * 2_200));
}

function heatWeight(count: number): number {
  return Math.min(100, Math.max(1, Math.sqrt(count) * 4));
}

function infoHtml(cluster: GeoCluster): string {
  const samples =
    cluster.sampleNames.length > 0
      ? `<br/><span style="color:#94a3b8;font-size:11px">${cluster.sampleNames.slice(0, 2).join(', ')}</span>`
      : '';
  return `<div style="font-family:system-ui;font-size:12px;max-width:240px">
    <strong>${cluster.label}</strong><br/>
    <span>${cluster.count.toLocaleString('pt-BR')} contato(s)</span><br/>
    <span style="color:#64748b">${PRECISION_LABELS[cluster.precision] || cluster.precision}</span>
    ${samples}
  </div>`;
}

export const LeadsConcentrationMap: React.FC = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapLayersRef = useRef<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [geocoding, setGeocoding] = useState(false);
  const [config, setConfig] = useState<{ enabled: boolean; mapKey: string | null } | null>(null);
  const [summary, setSummary] = useState<LeadsGeoSummary | null>(null);
  const [layer, setLayer] = useState<GeoLayer>('city');
  const [mapMode, setMapMode] = useState<MapMode>('heatmap');
  const [filterState, setFilterState] = useState('');
  const [filterCity, setFilterCity] = useState('');
  const [filterDdd, setFilterDdd] = useState('');
  const [filterNeighborhood, setFilterNeighborhood] = useState('');

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

  const mappedClusters = useMemo(
    () => (summary?.clusters || []).filter((c) => c.lat != null && c.lng != null),
    [summary?.clusters]
  );

  const topList = useMemo(() => (summary?.clusters || []).slice(0, 15), [summary?.clusters]);

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

  const clearMapLayers = useCallback(() => {
    for (const item of mapLayersRef.current) {
      const layerObj = item as { setMap?: (m: null) => void; setVisible?: (v: boolean) => void };
      if (typeof layerObj.setMap === 'function') layerObj.setMap(null);
    }
    mapLayersRef.current = [];
  }, []);

  const renderMap = useCallback(async () => {
    if (!mapRef.current || !config?.mapKey || mappedClusters.length === 0) return;
    try {
      const g = await loadGoogleMapsScript(config.mapKey);
      clearMapLayers();

      const bounds = new g.maps.LatLngBounds();
      const map = new g.maps.Map(mapRef.current, {
        center: { lat: -14.235, lng: -51.9253 },
        zoom: 4,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        styles: [{ featureType: 'poi', stylers: [{ visibility: 'off' }] }]
      });

      const topKey = summary?.topConcentration?.key;

      for (const cluster of mappedClusters) {
        bounds.extend(new g.maps.LatLng(cluster.lat!, cluster.lng!));
      }

      if (mapMode === 'heatmap') {
        const heatData = mappedClusters.map((c) => ({
          location: new g.maps.LatLng(c.lat!, c.lng!),
          weight: heatWeight(c.count)
        }));
        const heat = new g.maps.visualization.HeatmapLayer({
          data: heatData,
          map,
          radius: 36,
          opacity: 0.72,
          dissipating: true
        });
        mapLayersRef.current.push(heat);
      } else {
        for (const cluster of mappedClusters) {
          const isTop = cluster.key === topKey;
          const circle = new g.maps.Circle({
            map,
            center: { lat: cluster.lat!, lng: cluster.lng! },
            radius: circleRadiusMeters(cluster.count),
            strokeColor: isTop ? '#dc2626' : '#0d9488',
            strokeOpacity: isTop ? 0.9 : 0.55,
            strokeWeight: isTop ? 2 : 1,
            fillColor: isTop ? '#ef4444' : '#14b8a6',
            fillOpacity: isTop ? 0.42 : 0.28,
            zIndex: isTop ? 10 : 1
          });
          const info = new g.maps.InfoWindow({ content: infoHtml(cluster) });
          g.maps.event.addListener(circle, 'click', () => info.open(map));
          mapLayersRef.current.push(circle);
        }
      }

      if (topKey) {
        const topCluster = mappedClusters.find((c) => c.key === topKey);
        if (topCluster) {
          const marker = new g.maps.Marker({
            map,
            position: { lat: topCluster.lat!, lng: topCluster.lng! },
            title: `Maior concentração: ${topCluster.label}`,
            zIndex: 99
          });
          const info = new g.maps.InfoWindow({
            content: `<div style="font-family:system-ui;font-size:12px">
              <strong style="color:#dc2626">Maior concentração</strong><br/>
              ${infoHtml(topCluster)}
            </div>`
          });
          g.maps.event.addListener(marker, 'click', () => info.open(map, marker));
          mapLayersRef.current.push(marker);
        }
      }

      if (mappedClusters.length > 0) map.fitBounds(bounds);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Mapa indisponível.';
      toast.error(msg);
    }
  }, [config?.mapKey, mappedClusters, mapMode, summary?.topConcentration?.key, clearMapLayers]);

  useEffect(() => {
    if (!loading && config?.mapKey && mappedClusters.length > 0) {
      void renderMap();
    } else if (mappedClusters.length === 0) {
      clearMapLayers();
    }
  }, [loading, config?.mapKey, mappedClusters, renderMap, clearMapLayers]);

  const handleGeocode = async () => {
    if (layer === 'ddd' || layer === 'state') {
      toast('Camada DDD/UF já usa coordenadas aproximadas — não precisa geocodificar.', { icon: 'ℹ️' });
      return;
    }
    if (!config?.enabled) {
      toast.error('Configure GOOGLE_MAPS_API_KEY no servidor (.env da VPS).');
      return;
    }
    setGeocoding(true);
    try {
      const r = await apiGeocodeLeadsClusters({ max: 60, layer, force: false });
      setSummary(r.summary);
      if (r.geocoded > 0) {
        toast.success(`${r.geocoded} região(ões) localizada(s) no mapa.`);
      } else if (r.failed > 0) {
        toast.error(
          `Nenhuma região nova. ${r.failed} sem endereço válido; ${r.pending} ainda pendentes. Preencha cidade/bairro nos contatos.`
        );
      } else if (r.pending === 0) {
        toast.success('Todas as regiões já estão no mapa (cache).');
      } else {
        toast(
          `${r.pending} região(ões) sem coordenada. Verifique se os contatos têm cidade ou CEP preenchidos.`,
          { icon: 'ℹ️' }
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na geocodificação.');
    } finally {
      setGeocoding(false);
    }
  };

  const handleLayerChange = (next: GeoLayer) => {
    setLayer(next);
    if (next === 'neighborhood') setFilterNeighborhood('');
    if (next !== 'city' && next !== 'neighborhood') {
      setFilterCity('');
      setFilterNeighborhood('');
    }
  };

  const stats = summary?.stats;
  const filters = summary?.filters;
  const top = summary?.topConcentration;
  const needsGeocode = layer === 'city' || layer === 'neighborhood';
  const showEmptyMap = config?.enabled && mappedClusters.length === 0;

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
              Mapa de calor com filtros por DDD, cidade, bairro e UF — maior concentração em destaque
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
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
              disabled={geocoding || loading || !config?.enabled}
              title={config?.enabled ? 'Geocodifica cidades/bairros via Google' : 'API key ausente no servidor'}
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
            <StatPill label="Total contatos" value={stats.filteredTotal} sub={stats.totalContacts !== stats.filteredTotal ? `de ${stats.totalContacts}` : undefined} />
            <StatPill label="Com telefone" value={stats.withPhone} />
            <StatPill label="Com cidade" value={stats.withCity} />
            <StatPill label="Com bairro" value={stats.withNeighborhood} />
            <StatPill
              label="Regiões no mapa"
              value={stats.clustersMapped}
              sub={
                stats.clustersPending > 0
                  ? `${stats.clustersPending} sem Google (aprox.)`
                  : stats.clustersMapped > 0
                    ? 'posições ativas'
                    : undefined
              }
            />
            <StatPill label="Camada" value={stats.clusters} sub={LAYER_LABELS[layer]} isText />
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
            </div>
          )}

          {!config?.enabled && (
            <div className="mb-4 rounded-xl border border-amber-200/80 bg-amber-50/80 dark:bg-amber-950/20 px-3 py-2 text-[12px] text-amber-900 dark:text-amber-200">
              Para o mapa interativo: chave no{' '}
              <a href="https://console.cloud.google.com/google/maps-apis" target="_blank" rel="noreferrer" className="underline font-semibold">
                Google Cloud
              </a>{' '}
              (Maps JavaScript + Geocoding), <code>GOOGLE_MAPS_API_KEY</code> no <code>.env</code> da VPS.
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-3">
            <FilterSelect label="Camada" value={layer} onChange={(v) => handleLayerChange(v as GeoLayer)}>
              {(Object.keys(LAYER_LABELS) as GeoLayer[]).map((k) => (
                <option key={k} value={k}>{LAYER_LABELS[k]}</option>
              ))}
            </FilterSelect>
            <FilterSelect label="UF" value={filterState} onChange={setFilterState}>
              <option value="">Todas</option>
              {(filters?.states || []).map((s) => (
                <option key={s} value={s}>{s} ({summary?.byState[s] ?? 0})</option>
              ))}
            </FilterSelect>
            <FilterSelect label="DDD" value={filterDdd} onChange={setFilterDdd}>
              <option value="">Todos</option>
              {(filters?.ddds || []).map((d) => (
                <option key={d} value={d}>DDD {d} ({summary?.byDdd[d] ?? 0})</option>
              ))}
            </FilterSelect>
            {(layer === 'city' || layer === 'neighborhood') && (
              <FilterSelect label="Cidade" value={filterCity} onChange={setFilterCity}>
                <option value="">Todas</option>
                {(filters?.cities || []).map((c) => (
                  <option key={c} value={c}>{c} ({summary?.byCity[c] ?? 0})</option>
                ))}
              </FilterSelect>
            )}
            {layer === 'neighborhood' && (
              <FilterSelect label="Bairro" value={filterNeighborhood} onChange={setFilterNeighborhood}>
                <option value="">Todos</option>
                {(filters?.neighborhoods || []).map((n) => (
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
                disabled={!config?.mapKey}
              >
                Calor
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mapMode === 'circles' ? 'primary' : 'ghost'}
                leftIcon={<MapPin className="w-3.5 h-3.5" />}
                onClick={() => setMapMode('circles')}
                disabled={!config?.mapKey}
              >
                Círculos
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4">
            <div className="relative w-full min-h-[320px] h-[380px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
              <div ref={mapRef} className="absolute inset-0 w-full h-full" />
              {showEmptyMap && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 text-slate-500 bg-slate-100/90 dark:bg-slate-800/90 z-10 pointer-events-none">
                  <MapPin className="w-8 h-8 mb-2 opacity-40" />
                  <p className="text-sm font-medium">Nenhuma região para exibir.</p>
                  <p className="text-xs mt-1 max-w-sm">
                    {layer === 'ddd'
                      ? 'Contatos precisam de telefone com DDD válido.'
                      : layer === 'state'
                        ? 'Contatos precisam de UF no cadastro ou DDD no telefone.'
                        : 'Preencha cidade/bairro nos contatos e clique em Localizar no mapa.'}
                  </p>
                </div>
              )}
              {!config?.enabled && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500 px-6 text-center bg-slate-100 dark:bg-slate-800 z-10">
                  Configure a API do Google Maps no servidor para ver o mapa interativo.
                </div>
              )}
            </div>

            <div className="space-y-3 min-h-0">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Ranking — {LAYER_LABELS[layer]}
                </p>
                <div className="space-y-1 max-h-[280px] overflow-y-auto pr-1">
                  {topList.length === 0 ? (
                    <p className="text-xs text-slate-500">Nenhum contato neste filtro/camada.</p>
                  ) : (
                    topList.map((c, i) => (
                      <ClusterRow key={c.key} cluster={c} rank={i + 1} isTop={c.key === top?.key} />
                    ))
                  )}
                </div>
              </div>
              {layer === 'ddd' && Object.keys(summary?.byDdd || {}).length > 0 && (
                <DddChips byDdd={summary!.byDdd} active={filterDdd} onPick={setFilterDdd} />
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

const ClusterRow: React.FC<{ cluster: GeoCluster; rank: number; isTop?: boolean }> = ({
  cluster,
  rank,
  isTop
}) => (
  <div
    className={`flex items-center justify-between gap-2 text-xs py-1.5 border-b border-slate-100 dark:border-slate-800/80 last:border-0 ${
      isTop ? 'bg-rose-50/60 dark:bg-rose-950/20 -mx-1 px-1 rounded' : ''
    }`}
  >
    <div className="min-w-0 flex items-center gap-1.5">
      <span className="w-4 text-[10px] font-mono text-slate-400 shrink-0">{rank}</span>
      <Users className="w-3 h-3 text-slate-400 shrink-0" />
      <span className="truncate font-medium text-slate-800 dark:text-slate-100">{cluster.label}</span>
      {!cluster.mapped && <span className="text-[9px] text-amber-600 shrink-0">sem mapa</span>}
    </div>
    <span className="font-mono font-bold tabular-nums text-slate-500 shrink-0">
      {cluster.count.toLocaleString('pt-BR')}
    </span>
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
