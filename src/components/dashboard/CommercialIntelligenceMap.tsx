/**
 * CommercialIntelligenceMap — Mapa de Inteligência Comercial
 *
 * Cruza a geografia dos contatos com o resultado das campanhas. Três camadas
 * alternáveis sobre o OpenStreetMap (gratuito):
 *   1. Calor (densidade de leads/respostas)
 *   2. Conversão (bolhas por cidade coloridas pela taxa de resposta)
 *   3. Cobertura (choropleth por estado com polígonos do IBGE)
 *
 * Painéis: cobertura nacional, zonas quentes (mais convertem) e zonas frias
 * (muitos leads, pouca resposta = oportunidade).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import {
  Activity,
  Flame,
  Snowflake,
  Layers,
  Loader2,
  MapPin,
  RefreshCw,
  Target,
  TrendingUp,
  AlertTriangle,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  fetchCommercialIntelligence,
  fetchBrazilStatesGeoJson,
  type CommercialIntelligence,
  type RegionConversion,
} from '../../services/leadsGeoApi';
import { fixBrazilCoord, isMapCoordValid } from '../../utils/brazilMapCoords';
import { Button } from '../ui/Button';

type MapLayer = 'heat' | 'conversion' | 'coverage';

// leaflet.heat anexa L.heatLayer como side-effect; tipamos localmente sem augmentar o namespace.
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

const BR_CENTER: L.LatLngExpression = [-14.5, -51.5];
const BR_ZOOM = 4;

const TEMP_COLORS: Record<RegionConversion['temperature'], string> = {
  hot: '#ef4444',
  warm: '#f59e0b',
  cold: '#3b82f6',
  untouched: '#94a3b8',
};

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** Cor do choropleth por taxa de resposta (verde = converte mais). */
function coverageColor(replyRate: number, contacted: number): string {
  if (contacted === 0) return '#1e293b';
  if (replyRate >= 0.15) return '#16a34a';
  if (replyRate >= 0.08) return '#65a30d';
  if (replyRate >= 0.04) return '#ca8a04';
  if (replyRate >= 0.01) return '#ea580c';
  return '#b91c1c';
}

export const CommercialIntelligenceMap: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const heatRef = useRef<HeatLayerInstance | null>(null);
  const geoJsonRef = useRef<L.GeoJSON | null>(null);
  const statesGeoRef = useRef<GeoJSON.FeatureCollection | null>(null);

  const [data, setData] = useState<CommercialIntelligence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [layer, setLayer] = useState<MapLayer>('conversion');

  // ── Inicializa o mapa ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current, {
      center: BR_CENTER,
      zoom: BR_ZOOM,
      zoomControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    layerGroupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Carrega dados de inteligência ──────────────────────────────────────────
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const result = await fetchCommercialIntelligence();
      setData(result);
    } catch (e: any) {
      const msg = e?.message || 'Erro ao carregar o mapa de inteligência.';
      setError(msg);
      if (!silent) toast.error(msg);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Pré-carrega polígonos dos estados (uma vez) ────────────────────────────
  useEffect(() => {
    void (async () => {
      try {
        const geo = await fetchBrazilStatesGeoJson();
        statesGeoRef.current = geo as unknown as GeoJSON.FeatureCollection;
        // Se a camada de cobertura já estiver ativa, redesenha
        if (layer === 'coverage' && data) renderLayer();
      } catch {
        /* choropleth opcional — segue sem polígonos */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Renderiza a camada ativa ───────────────────────────────────────────────
  const renderLayer = useCallback(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group || !data) return;

    group.clearLayers();
    if (heatRef.current) {
      map.removeLayer(heatRef.current);
      heatRef.current = null;
    }
    if (geoJsonRef.current) {
      map.removeLayer(geoJsonRef.current);
      geoJsonRef.current = null;
    }

    // ── Camada de calor ──────────────────────────────────────────────────
    if (layer === 'heat') {
      const points: [number, number, number][] = [];
      for (const p of data.heatPoints) {
        const { lat, lng } = fixBrazilCoord(p.lat, p.lng);
        if (isMapCoordValid(lat, lng)) points.push([lat, lng, p.weight]);
      }
      const hl = heatLayer(points, {
        radius: 25,
        blur: 18,
        maxZoom: 12,
        gradient: { 0.2: '#3b82f6', 0.4: '#22c55e', 0.6: '#eab308', 0.8: '#f97316', 1: '#ef4444' },
      });
      hl.addTo(map);
      heatRef.current = hl;
      return;
    }

    // ── Camada de conversão (bolhas por cidade) ──────────────────────────
    if (layer === 'conversion') {
      const maxLeads = Math.max(...data.byCity.map((r) => r.leads), 1);
      for (const r of data.byCity) {
        if (r.lat == null || r.lng == null) continue;
        const { lat, lng } = fixBrazilCoord(r.lat, r.lng);
        if (!isMapCoordValid(lat, lng)) continue;
        const radius = 6 + Math.sqrt(r.leads / maxLeads) * 26;
        const color = TEMP_COLORS[r.temperature];
        const circle = L.circleMarker([lat, lng], {
          radius,
          color: '#0b1120',
          weight: 1,
          fillColor: color,
          fillOpacity: 0.72,
        });
        circle.bindPopup(
          L.popup({ maxWidth: 280 }).setContent(`
            <div style="font-family:system-ui,sans-serif;padding:2px 0">
              <div style="font-weight:800;font-size:14px;margin-bottom:6px">${r.label}</div>
              <div style="display:grid;grid-template-columns:auto auto;gap:2px 12px;font-size:12px;color:#444">
                <span>Leads</span><strong style="text-align:right">${r.leads.toLocaleString('pt-BR')}</strong>
                <span>Contactados</span><strong style="text-align:right">${r.contacted.toLocaleString('pt-BR')}</strong>
                <span>Enviados</span><strong style="text-align:right">${r.sent.toLocaleString('pt-BR')}</strong>
                <span>Entregues</span><strong style="text-align:right">${r.delivered.toLocaleString('pt-BR')}</strong>
                <span>Respostas</span><strong style="text-align:right">${r.replied.toLocaleString('pt-BR')}</strong>
              </div>
              <div style="margin-top:8px;padding-top:6px;border-top:1px solid #eee;font-size:12px">
                <span style="color:#444">Taxa de resposta: </span>
                <strong style="color:${color}">${pct(r.replyRate)}</strong>
              </div>
            </div>
          `)
        );
        group.addLayer(circle);
      }
      return;
    }

    // ── Camada de cobertura (choropleth por estado) ──────────────────────
    if (layer === 'coverage') {
      const stateByUf = new Map(data.byState.map((r) => [r.state.toUpperCase(), r]));
      const geo = statesGeoRef.current;
      if (geo) {
        geoJsonRef.current = L.geoJSON(geo, {
          style: (feature) => {
            const uf = String((feature?.properties as any)?.uf || '').toUpperCase();
            const r = stateByUf.get(uf);
            return {
              fillColor: r ? coverageColor(r.replyRate, r.contacted) : '#1e293b',
              fillOpacity: 0.65,
              color: '#0b1120',
              weight: 1,
            };
          },
          onEachFeature: (feature, lyr) => {
            const uf = String((feature?.properties as any)?.uf || '').toUpperCase();
            const r = stateByUf.get(uf);
            if (!r) {
              lyr.bindPopup(`<strong>${uf}</strong><br/>Sem dados`);
              return;
            }
            lyr.bindPopup(`
              <div style="font-family:system-ui,sans-serif;min-width:170px">
                <div style="font-weight:800;font-size:14px;margin-bottom:6px">${r.label} (${r.state})</div>
                <div style="display:grid;grid-template-columns:auto auto;gap:2px 12px;font-size:12px;color:#444">
                  <span>Leads</span><strong style="text-align:right">${r.leads.toLocaleString('pt-BR')}</strong>
                  <span>Cobertura</span><strong style="text-align:right">${pct(r.coverageRate)}</strong>
                  <span>Entregues</span><strong style="text-align:right">${r.delivered.toLocaleString('pt-BR')}</strong>
                  <span>Respostas</span><strong style="text-align:right">${r.replied.toLocaleString('pt-BR')}</strong>
                  <span>Taxa resp.</span><strong style="text-align:right">${pct(r.replyRate)}</strong>
                </div>
              </div>
            `);
          },
        }).addTo(map);
      } else {
        // Fallback sem polígonos: bolhas por estado
        for (const r of data.byState) {
          if (r.lat == null || r.lng == null) continue;
          const { lat, lng } = fixBrazilCoord(r.lat, r.lng);
          if (!isMapCoordValid(lat, lng)) continue;
          const circle = L.circleMarker([lat, lng], {
            radius: 10 + Math.log10(r.leads + 1) * 8,
            color: '#0b1120',
            weight: 1,
            fillColor: coverageColor(r.replyRate, r.contacted),
            fillOpacity: 0.7,
          });
          circle.bindPopup(`<strong>${r.label}</strong><br/>${r.leads} leads · resp. ${pct(r.replyRate)}`);
          group.addLayer(circle);
        }
      }
    }
  }, [data, layer]);

  useEffect(() => {
    renderLayer();
  }, [renderLayer]);

  const flyToRegion = useCallback((r: RegionConversion) => {
    const map = mapRef.current;
    if (!map || r.lat == null || r.lng == null) return;
    const { lat, lng } = fixBrazilCoord(r.lat, r.lng);
    if (!isMapCoordValid(lat, lng)) return;
    map.flyTo([lat, lng], 9, { animate: true, duration: 1.2 });
  }, []);

  const nat = data?.national;

  const kpis = useMemo(() => {
    if (!nat) return [];
    return [
      { label: 'Leads com geo', value: nat.geoLeads.toLocaleString('pt-BR'), icon: <Users className="w-4 h-4" />, color: '#3b82f6' },
      { label: 'Cobertura', value: pct(nat.coveragePct), icon: <Target className="w-4 h-4" />, color: '#06B6D4', sub: `${nat.contactedLeads.toLocaleString('pt-BR')} contactados` },
      { label: 'Taxa de resposta', value: pct(nat.replyRate), icon: <TrendingUp className="w-4 h-4" />, color: '#16a34a', sub: `${nat.replied.toLocaleString('pt-BR')} respostas` },
      { label: 'Estados ativos', value: `${nat.statesCovered}/27`, icon: <MapPin className="w-4 h-4" />, color: '#f59e0b', sub: `${nat.campaignsConsidered} campanha(s)` },
    ];
  }, [nat]);

  return (
    <div
      className={embedded ? 'h-full flex flex-col' : 'rounded-2xl overflow-hidden'}
      style={embedded ? undefined : { background: 'var(--surface-0)', border: '1px solid var(--border)' }}
    >
      {!embedded && (
      <>
      {/* Header */}
      <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-[18px] shrink-0" style={{ background: 'linear-gradient(135deg,#ef444420,#f59e0b20)' }}>
              <Activity className="w-5 h-5" style={{ color: '#ef4444' }} />
            </div>
            <div>
              <h3 className="font-bold text-[15px]" style={{ color: 'var(--text-1)' }}>Mapa de Inteligência Comercial</h3>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Onde seus disparos convertem — geografia x resultado de campanha</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()} loading={loading} leftIcon={<RefreshCw className="w-3.5 h-3.5" />}>
            Atualizar
          </Button>
        </div>

        {/* KPIs nacionais */}
        {kpis.length > 0 && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-xl px-3 py-2.5" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center gap-1.5 mb-1" style={{ color: k.color }}>
                  {k.icon}
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{k.label}</span>
                </div>
                <div className="text-[18px] font-extrabold leading-none" style={{ color: 'var(--text-1)' }}>{k.value}</div>
                {k.sub && <div className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{k.sub}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
      </>
      )}

      {embedded && (
        <div className="px-4 py-2 border-b flex items-center justify-end" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <Button variant="ghost" size="sm" onClick={() => void load()} loading={loading} leftIcon={<RefreshCw className="w-3.5 h-3.5" />}>
            Atualizar
          </Button>
        </div>
      )}

      {/* Seletor de camadas */}
      <div
        className="px-4 py-3 border-b flex items-center gap-2 flex-wrap"
        style={{
          borderColor: embedded ? 'rgba(255,255,255,0.06)' : 'var(--border-subtle)',
          background: embedded ? 'transparent' : 'var(--surface-1)',
        }}
      >
        <Layers className="w-4 h-4" style={{ color: 'var(--text-3)' }} />
        {([
          { id: 'conversion' as MapLayer, label: 'Conversão', icon: <Target className="w-3.5 h-3.5" /> },
          { id: 'heat' as MapLayer, label: 'Calor', icon: <Flame className="w-3.5 h-3.5" /> },
          { id: 'coverage' as MapLayer, label: 'Cobertura (UF)', icon: <MapPin className="w-3.5 h-3.5" /> },
        ]).map((opt) => {
          const active = layer === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setLayer(opt.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
              style={{
                background: active ? 'var(--brand)' : 'var(--surface-0)',
                color: active ? '#fff' : 'var(--text-2)',
                border: `1px solid ${active ? 'var(--brand)' : 'var(--border)'}`,
              }}
            >
              {opt.icon}
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Mapa */}
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3" style={{ background: 'var(--surface-0)', opacity: 0.9 }}>
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--brand)' }} />
            <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>Cruzando geografia com campanhas…</p>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: 'var(--surface-0)', opacity: 0.95 }}>
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>{error}</p>
            <Button variant="secondary" size="sm" onClick={() => void load()}>Tentar novamente</Button>
          </div>
        )}
        <div ref={mapContainerRef} style={{ height: embedded ? '400px' : '460px', width: '100%', zIndex: 0 }} />
      </div>

      {!embedded && (
      <>
      {/* Legenda */}
      <div className="px-5 py-2.5 border-t flex flex-wrap items-center gap-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
        {layer === 'conversion' && (
          <>
            <LegendDot color={TEMP_COLORS.hot} label="Quente (resp. ≥15%)" />
            <LegendDot color={TEMP_COLORS.warm} label="Morna (≥5%)" />
            <LegendDot color={TEMP_COLORS.cold} label="Fria (<5%)" />
            <LegendDot color={TEMP_COLORS.untouched} label="Sem disparo" />
            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>Tamanho = volume de leads</span>
          </>
        )}
        {layer === 'heat' && <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>Densidade de leads (respostas pesam mais). Azul → vermelho = mais concentrado.</span>}
        {layer === 'coverage' && (
          <>
            <LegendDot color="#16a34a" label="Converte muito" />
            <LegendDot color="#ca8a04" label="Médio" />
            <LegendDot color="#b91c1c" label="Baixa resposta" />
            <LegendDot color="#1e293b" label="Sem disparo" />
          </>
        )}
        <span className="ml-auto text-[10px]" style={{ color: 'var(--text-3)' }}>© OpenStreetMap · IBGE</span>
      </div>

      {/* Painéis: zonas quentes e frias */}
      {data && (
        <div className="grid md:grid-cols-2 gap-px" style={{ background: 'var(--border-subtle)' }}>
          <ZonePanel
            title="Zonas quentes"
            subtitle="Onde sua mensagem mais converte"
            icon={<Flame className="w-4 h-4 text-red-500" />}
            zones={data.hotZones}
            emptyText="Ainda sem regiões com respostas suficientes. Dispare mais para gerar dados."
            metric={(r) => pct(r.replyRate)}
            metricColor="#16a34a"
            onClick={flyToRegion}
          />
          <ZonePanel
            title="Oportunidades (zonas frias)"
            subtitle="Muitos leads, pouca resposta"
            icon={<Snowflake className="w-4 h-4 text-blue-400" />}
            zones={data.coldZones}
            emptyText="Nenhuma zona fria relevante encontrada."
            metric={(r) => `${r.leads.toLocaleString('pt-BR')} leads`}
            metricColor="#3b82f6"
            onClick={flyToRegion}
          />
        </div>
      )}
      </>
      )}
    </div>
  );
};

const LegendDot: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <div className="flex items-center gap-1.5">
    <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
    <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{label}</span>
  </div>
);

const ZonePanel: React.FC<{
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  zones: RegionConversion[];
  emptyText: string;
  metric: (r: RegionConversion) => string;
  metricColor: string;
  onClick: (r: RegionConversion) => void;
}> = ({ title, subtitle, icon, zones, emptyText, metric, metricColor, onClick }) => (
  <div className="p-4" style={{ background: 'var(--surface-0)' }}>
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <div>
        <h4 className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>{title}</h4>
        <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{subtitle}</p>
      </div>
    </div>
    {zones.length === 0 ? (
      <p className="text-[11px] py-3" style={{ color: 'var(--text-3)' }}>{emptyText}</p>
    ) : (
      <ul className="space-y-1">
        {zones.map((r, i) => (
          <li key={r.key}>
            <button
              onClick={() => onClick(r)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors hover:bg-[var(--surface-1)]"
            >
              <span className="text-[11px] font-bold w-5 text-center shrink-0" style={{ color: 'var(--text-3)' }}>{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>{r.label}</div>
                <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                  {r.contacted.toLocaleString('pt-BR')} contactados · {r.replied.toLocaleString('pt-BR')} respostas
                </div>
              </div>
              <span className="text-[12px] font-extrabold tabular-nums shrink-0" style={{ color: metricColor }}>{metric(r)}</span>
            </button>
          </li>
        ))}
      </ul>
    )}
  </div>
);
