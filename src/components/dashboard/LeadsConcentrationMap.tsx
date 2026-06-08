import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MapPin, RefreshCw, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card } from '../ui';
import {
  apiGeocodeLeadsClusters,
  fetchLeadsGeoConfig,
  fetchLeadsGeoSummary,
  type GeoCluster,
  type LeadsGeoSummary
} from '../../services/leadsGeoApi';

type GoogleMapsNS = {
  maps: {
    Map: new (el: HTMLElement, opts: Record<string, unknown>) => {
      fitBounds: (b: unknown) => void;
    };
    LatLng: new (lat: number, lng: number) => unknown;
    LatLngBounds: new () => { extend: (p: unknown) => void };
    Circle: new (opts: Record<string, unknown>) => unknown;
    InfoWindow: new (opts?: Record<string, unknown>) => { open: (map: unknown, anchor?: unknown) => void };
    event: { addListener: (target: unknown, event: string, fn: () => void) => void };
  };
};

declare global {
  interface Window {
    google?: GoogleMapsNS;
  }
}

function loadGoogleMapsScript(apiKey: string): Promise<GoogleMapsNS> {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) return resolve(window.google);
    const id = 'zapmass-google-maps-js';
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => {
        if (window.google?.maps) resolve(window.google);
        else reject(new Error('Google Maps não carregou.'));
      });
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&language=pt-BR&region=BR`;
    script.onload = () => {
      if (window.google?.maps) resolve(window.google);
      else reject(new Error('Google Maps indisponível.'));
    };
    script.onerror = () => reject(new Error('Falha ao carregar Google Maps.'));
    document.head.appendChild(script);
  });
}

function circleRadiusMeters(count: number): number {
  return Math.min(80_000, Math.max(8_000, Math.sqrt(count) * 2_200));
}

export const LeadsConcentrationMap: React.FC = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [geocoding, setGeocoding] = useState(false);
  const [config, setConfig] = useState<{ enabled: boolean; mapKey: string | null } | null>(null);
  const [summary, setSummary] = useState<LeadsGeoSummary | null>(null);

  const mappedClusters = useMemo(
    () => (summary?.clusters || []).filter((c) => c.lat != null && c.lng != null),
    [summary?.clusters]
  );

  const topCities = useMemo(() => (summary?.clusters || []).slice(0, 12), [summary?.clusters]);

  const topStates = useMemo(() => {
    const entries = Object.entries(summary?.byState || {});
    return entries.sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [summary?.byState]);

  const refreshSummary = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, sum] = await Promise.all([fetchLeadsGeoConfig(), fetchLeadsGeoSummary()]);
      setConfig(cfg);
      setSummary(sum);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar mapa de leads.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);

  const renderMap = useCallback(async () => {
    if (!mapRef.current || !config?.mapKey || mappedClusters.length === 0) return;
    try {
      const g = await loadGoogleMapsScript(config.mapKey);
      const bounds = new g.maps.LatLngBounds();
      const map = new g.maps.Map(mapRef.current, {
        center: { lat: -14.235, lng: -51.9253 },
        zoom: 4,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        styles: [
          { featureType: 'poi', stylers: [{ visibility: 'off' }] }
        ]
      });
      mapInstanceRef.current = map;

      for (const cluster of mappedClusters) {
        const lat = cluster.lat!;
        const lng = cluster.lng!;
        const pos = new g.maps.LatLng(lat, lng);
        bounds.extend(pos);
        const circle = new g.maps.Circle({
          map,
          center: { lat, lng },
          radius: circleRadiusMeters(cluster.count),
          strokeColor: '#0d9488',
          strokeOpacity: 0.55,
          strokeWeight: 1,
          fillColor: '#14b8a6',
          fillOpacity: 0.28
        });
        const info = new g.maps.InfoWindow({
          content: `<div style="font-family:system-ui;font-size:12px;max-width:220px">
            <strong>${cluster.city}${cluster.state !== '—' ? ` · ${cluster.state}` : ''}</strong><br/>
            <span>${cluster.count.toLocaleString('pt-BR')} lead(s)</span><br/>
            <span style="color:#64748b">${cluster.precision === 'address' ? 'Endereço' : cluster.precision === 'city' ? 'Cidade' : 'Estado'}</span>
          </div>`
        });
        g.maps.event.addListener(circle, 'click', () => info.open(map));
      }
      if (mappedClusters.length > 0) map.fitBounds(bounds);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Mapa indisponível.';
      toast.error(msg);
    }
  }, [config?.mapKey, mappedClusters]);

  useEffect(() => {
    if (!loading && config?.mapKey && mappedClusters.length > 0) {
      void renderMap();
    }
  }, [loading, config?.mapKey, mappedClusters, renderMap]);

  const handleGeocode = async () => {
    if (!config?.enabled) {
      toast.error('Configure GOOGLE_MAPS_API_KEY no servidor (.env da VPS).');
      return;
    }
    setGeocoding(true);
    try {
      const r = await apiGeocodeLeadsClusters(50);
      setSummary(r.summary);
      toast.success(
        r.geocoded > 0
          ? `${r.geocoded} região(ões) localizada(s) no mapa.`
          : 'Nenhuma região nova geocodificada (já em cache ou sem endereço).'
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na geocodificação.');
    } finally {
      setGeocoding(false);
    }
  };

  const stats = summary?.stats;

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
              Mapa de concentração por cidade/UF a partir de endereço, CEP e cidade nos contatos
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
            onClick={() => void refreshSummary()}
            disabled={loading}
          >
            Atualizar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="primary"
            leftIcon={geocoding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
            onClick={() => void handleGeocode()}
            disabled={geocoding || loading || !config?.enabled}
            title={config?.enabled ? 'Busca coordenadas no Google Maps (crédito gratuito)' : 'API key ausente no servidor'}
          >
            Localizar no mapa
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          Carregando distribuição geográfica…
        </div>
      ) : !stats ? (
        <p className="text-sm text-slate-500 py-8 text-center">Sem dados de contatos.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <StatPill label="Com endereço" value={stats.withAnyAddress} />
            <StatPill label="Cidade preenchida" value={stats.withCity} />
            <StatPill label="Regiões no mapa" value={stats.clustersMapped} />
            <StatPill label="Total contatos" value={stats.totalContacts} />
          </div>

          {!config?.enabled && (
            <div className="mb-4 rounded-xl border border-amber-200/80 bg-amber-50/80 dark:bg-amber-950/20 px-3 py-2 text-[12px] text-amber-900 dark:text-amber-200">
              Para ativar o mapa: crie uma chave no{' '}
              <a
                href="https://console.cloud.google.com/google/maps-apis"
                target="_blank"
                rel="noreferrer"
                className="underline font-semibold"
              >
                Google Cloud Maps
              </a>{' '}
              (Geocoding + Maps JavaScript API), adicione <code>GOOGLE_MAPS_API_KEY=...</code> no{' '}
              <code>.env</code> da VPS e faça deploy. O plano inclui crédito mensal gratuito (~US$ 200).
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4">
            <div
              ref={mapRef}
              className="w-full min-h-[320px] h-[360px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800"
            >
              {config?.enabled && mappedClusters.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                  <MapPin className="w-8 h-8 mb-2 opacity-40" />
                  <p className="text-sm font-medium">Nenhuma região localizada ainda.</p>
                  <p className="text-xs mt-1 max-w-xs">
                    Clique em <strong>Localizar no mapa</strong> para geocodificar cidades com base nos
                    endereços dos contatos.
                  </p>
                </div>
              )}
              {!config?.enabled && (
                <div className="h-full flex items-center justify-center text-sm text-slate-500 px-6 text-center">
                  Configure a API do Google Maps no servidor para ver o mapa interativo.
                </div>
              )}
            </div>

            <div className="space-y-3 min-h-0">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Top cidades / regiões
                </p>
                <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1">
                  {topCities.length === 0 ? (
                    <p className="text-xs text-slate-500">Nenhum contato com cidade ou endereço.</p>
                  ) : (
                    topCities.map((c) => <ClusterRow key={c.key} cluster={c} />)
                  )}
                </div>
              </div>
              {topStates.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Por estado (UF)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {topStates.map(([uf, n]) => (
                      <span
                        key={uf}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                      >
                        {uf}
                        <span className="text-slate-400 font-mono tabular-nums">{n}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </Card>
  );
};

const StatPill: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-xl px-3 py-2 border border-slate-200/80 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-900/30">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
    <p className="text-lg font-black tabular-nums text-slate-900 dark:text-white">
      {value.toLocaleString('pt-BR')}
    </p>
  </div>
);

const ClusterRow: React.FC<{ cluster: GeoCluster }> = ({ cluster }) => (
  <div className="flex items-center justify-between gap-2 text-xs py-1.5 border-b border-slate-100 dark:border-slate-800/80 last:border-0">
    <div className="min-w-0 flex items-center gap-1.5">
      <Users className="w-3 h-3 text-slate-400 shrink-0" />
      <span className="truncate font-medium text-slate-800 dark:text-slate-100">
        {cluster.city}
        {cluster.state !== '—' ? ` · ${cluster.state}` : ''}
      </span>
    </div>
    <span className="font-mono font-bold tabular-nums text-slate-500 shrink-0">
      {cluster.count.toLocaleString('pt-BR')}
    </span>
  </div>
);
