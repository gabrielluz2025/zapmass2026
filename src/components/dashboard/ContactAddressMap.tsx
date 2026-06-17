/**
 * ContactAddressMap
 *
 * Mapa interativo de contatos pelo endereço cadastrado (rua, cidade, CEP).
 * Usa Leaflet + OpenStreetMap (gratuito, sem API key).
 * Ícones 100% SVG — sem PNG, sem quebra no Vite.
 *
 * Fluxo:
 *  1. Carrega summary do servidor (contatos geocodificados → pins com lat/lng)
 *  2. Exibe no mapa; clusters de cidade quando há muitos pins
 *  3. Botão "Geocodificar" chama o servidor para mapear endereços pendentes
 *  4. Search por nome → fly-to no contato
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  X,
  Navigation,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  fetchLeadsGeoSummary,
  apiGeocodeContacts,
  type GeoContactPin,
  type LeadsGeoSummary,
} from '../../services/leadsGeoApi';
import { fixBrazilCoord, isMapCoordValid } from '../../utils/brazilMapCoords';
import { Button } from '../ui/Button';
import { AddressIntelligencePanel } from './AddressIntelligencePanel';

// ── Ícones SVG sem PNG ────────────────────────────────────────────────────────

function makePinIcon(color: string, size = 28): L.DivIcon {
  const h = Math.round(size * 1.4);
  return L.divIcon({
    className: '',
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${h}" viewBox="0 0 28 40">
      <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 26 14 26S28 24.5 28 14C28 6.268 21.732 0 14 0z"
            fill="${color}" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>
      <circle cx="14" cy="14" r="6" fill="white" fill-opacity="0.9"/>
    </svg>`,
    iconSize: [size, h],
    iconAnchor: [size / 2, h],
    popupAnchor: [0, -h],
  });
}

function makeClusterIcon(color: string, count: number): L.DivIcon {
  const r = count >= 1000 ? 32 : count >= 100 ? 28 : count >= 10 ? 24 : 20;
  const fontSize = count >= 1000 ? 11 : count >= 100 ? 12 : 13;
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${r * 2}px;height:${r * 2}px;border-radius:50%;
      background:${color};border:3px solid rgba(255,255,255,0.8);
      display:flex;align-items:center;justify-content:center;
      font-size:${fontSize}px;font-weight:900;color:#fff;
      box-shadow:0 3px 12px rgba(0,0,0,0.35);
      text-shadow:0 1px 2px rgba(0,0,0,0.4);
    ">${count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count}</div>`,
    iconSize: [r * 2, r * 2],
    iconAnchor: [r, r],
    popupAnchor: [0, -r - 4],
  });
}

const PIN_COLOR = '#3b82f6';
const CLUSTER_COLOR = '#6366f1';
const APPROX_COLOR = '#f59e0b';

// ── Constantes ────────────────────────────────────────────────────────────────

const BR_CENTER: L.LatLngExpression = [-14.5, -51.5];
const BR_ZOOM = 4;
const PIN_ZOOM = 15;
const CITY_ZOOM = 12;

// ── Componente ────────────────────────────────────────────────────────────────

export const ContactAddressMap: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.Layer[]>([]);

  const [summary, setSummary] = useState<LeadsGeoSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState<{ done: number; total: number } | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<GeoContactPin[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedPin, setSelectedPin] = useState<GeoContactPin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoGeocodeRef = useRef(false);

  // ── Inicializa mapa ────────────────────────────────────────────────────────
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

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Carrega dados ──────────────────────────────────────────────────────────
  const loadSummary = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await fetchLeadsGeoSummary({ layer: 'city' });
      setSummary(data);
    } catch (e: any) {
      const msg = e?.message || 'Erro ao carregar mapa de endereços.';
      setError(msg);
      if (!silent) toast.error(msg);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  // ── Auto-geocodifica endereços pendentes ao carregar ───────────────────────
  useEffect(() => {
    if (!summary || autoGeocodeRef.current) return;
    const pending = Math.max(
      0,
      (summary.pinStats?.withFullAddress ?? 0) - (summary.pinStats?.pinsMapped ?? 0)
    );
    if (pending <= 0) return;

    autoGeocodeRef.current = true;

    const runBatch = async (remaining: number, doneAcc: number, total: number) => {
      if (remaining <= 0) {
        setGeocoding(false);
        setGeocodeProgress(null);
        void loadSummary(true);
        return;
      }
      setGeocoding(true);
      setGeocodeProgress({ done: doneAcc, total });
      try {
        const result = await apiGeocodeContacts({ max: 500 });
        const newDone = doneAcc + result.geocoded;
        setSummary(result.summary);
        setGeocodeProgress({ done: newDone, total });
        // Se ainda houver pendentes, continua
        const stillPending = Math.max(
          0,
          (result.summary.pinStats?.withFullAddress ?? 0) -
          (result.summary.pinStats?.pinsMapped ?? 0)
        );
        if (result.geocoded > 0 && stillPending > 0) {
          await runBatch(stillPending, newDone, total);
        } else {
          setGeocoding(false);
          setGeocodeProgress(null);
          void loadSummary(true);
        }
      } catch {
        setGeocoding(false);
        setGeocodeProgress(null);
      }
    };

    void runBatch(pending, 0, pending);
  }, [summary, loadSummary]);

  // ── Pinta pins e clusters no mapa ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !summary) return;

    // Remove camadas anteriores
    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current = [];

    // Pins de contato individuais (geocodificados com precisão de endereço/bairro)
    for (const pin of summary.contactPins) {
      const { lat, lng } = fixBrazilCoord(pin.lat, pin.lng);
      if (!isMapCoordValid(lat, lng)) continue;

      const isApprox = pin.approximate || pin.precision === 'city';
      const icon = makePinIcon(isApprox ? APPROX_COLOR : PIN_COLOR, 24);

      const marker = L.marker([lat, lng], { icon });

      const popup = L.popup({ maxWidth: 280 }).setContent(`
        <div style="font-family:system-ui,sans-serif;padding:4px 0">
          <div style="font-weight:800;font-size:14px;margin-bottom:4px">${pin.name}</div>
          ${pin.street ? `<div style="font-size:12px;color:#555">${pin.street}${pin.number ? `, ${pin.number}` : ''}</div>` : ''}
          ${pin.neighborhood ? `<div style="font-size:12px;color:#555">${pin.neighborhood}</div>` : ''}
          <div style="font-size:12px;color:#555">${[pin.city, pin.state].filter(Boolean).join(' · ')}</div>
          <div style="margin-top:6px;font-size:10px;color:${isApprox ? '#d97706' : '#3b82f6'};font-weight:700;text-transform:uppercase;letter-spacing:0.05em">
            ${isApprox ? '⚠ Aproximado (cidade)' : '✓ Endereço exato'}
          </div>
        </div>
      `);

      marker.bindPopup(popup);
      marker.addTo(map);
      markersRef.current.push(marker);
    }

    // Clusters de cidade (quando não há pins individuais para a cidade)
    const citiesWithPins = new Set(summary.contactPins.map((p) => `${p.city}|${p.state}`));
    for (const cluster of summary.clusters) {
      if (!cluster.lat || !cluster.lng) continue;
      const { lat, lng } = fixBrazilCoord(cluster.lat, cluster.lng);
      if (!isMapCoordValid(lat, lng)) continue;
      if (citiesWithPins.has(`${cluster.city}|${cluster.state}`)) continue;

      const icon = makeClusterIcon(CLUSTER_COLOR, cluster.count);
      const marker = L.marker([lat, lng], { icon });

      const names = cluster.sampleNames?.slice(0, 3).join(', ') || '';
      marker.bindPopup(L.popup({ maxWidth: 260 }).setContent(`
        <div style="font-family:system-ui,sans-serif;padding:4px 0">
          <div style="font-weight:800;font-size:14px">${cluster.label}</div>
          <div style="font-size:12px;color:#555;margin-bottom:4px">${cluster.count} contatos</div>
          ${names ? `<div style="font-size:11px;color:#888">${names}${cluster.count > 3 ? '…' : ''}</div>` : ''}
          <div style="margin-top:6px;font-size:10px;color:#6366f1;font-weight:700;text-transform:uppercase">📍 Nível cidade</div>
        </div>
      `));

      marker.addTo(map);
      markersRef.current.push(marker);
    }
  }, [summary]);

  // ── Busca por nome ─────────────────────────────────────────────────────────
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await fetchLeadsGeoSummary({ name: q });
        setSearchResults(data.contactPins.slice(0, 20));
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 400);

    return () => window.clearTimeout(timer);
  }, [search]);

  // ── Fly-to ao clicar em resultado ─────────────────────────────────────────
  const flyToPin = useCallback((pin: GeoContactPin) => {
    const map = mapRef.current;
    if (!map) return;
    const { lat, lng } = fixBrazilCoord(pin.lat, pin.lng);
    if (!isMapCoordValid(lat, lng)) {
      toast.error(`${pin.name} ainda não tem coordenadas. Clique em "Geocodificar endereços".`);
      return;
    }
    setSelectedPin(pin);
    setSearch('');
    setSearchResults([]);
    map.flyTo([lat, lng], pin.precision === 'city' ? CITY_ZOOM : PIN_ZOOM, {
      animate: true,
      duration: 1.5,
    });
    // Abre o popup do marker correspondente
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker) {
        const pos = layer.getLatLng();
        if (Math.abs(pos.lat - lat) < 0.001 && Math.abs(pos.lng - lng) < 0.001) {
          layer.openPopup();
        }
      }
    });
  }, []);

  // ── Geocodificar pendentes (manual — força reprocessar) ───────────────────
  const handleGeocode = useCallback(async () => {
    setGeocoding(true);
    let totalDone = 0;
    autoGeocodeRef.current = true; // evita loop duplo
    try {
      let hasMore = true;
      while (hasMore) {
        const result = await apiGeocodeContacts({ max: 500 });
        totalDone += result.geocoded;
        setSummary(result.summary);
        setGeocodeProgress({ done: totalDone, total: totalDone + result.failed });
        const stillPending = Math.max(
          0,
          (result.summary.pinStats?.withFullAddress ?? 0) -
          (result.summary.pinStats?.pinsMapped ?? 0)
        );
        hasMore = result.geocoded > 0 && stillPending > 0;
      }
      toast.success(`${totalDone} endereço(s) geocodificado(s) no total.`);
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao geocodificar.');
    } finally {
      setGeocoding(false);
      setGeocodeProgress(null);
    }
  }, []);

  // ── Estat stats ───────────────────────────────────────────────────────────
  const pinStats = summary?.pinStats;
  const pendingCount = pinStats
    ? Math.max(0, (pinStats.withFullAddress || 0) - (pinStats.pinsMapped || 0))
    : 0;

  return (
    <div
      className={embedded ? 'h-full flex flex-col' : 'rounded-2xl overflow-hidden'}
      style={embedded ? undefined : { background: 'var(--surface-0)', border: '1px solid var(--border)' }}
    >
      {!embedded && (
      <>
      {/* ── Header ── */}
      <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-[18px] shrink-0"
              style={{ background: 'linear-gradient(135deg,#3b82f620,#6366f120)' }}
            >
              📍
            </div>
            <div>
              <h3 className="font-bold text-[15px]" style={{ color: 'var(--text-1)' }}>
                Mapa de Contatos por Endereço
              </h3>
              <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                Pins no endereço cadastrado (rua, cidade, CEP) — OpenStreetMap
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {geocoding && geocodeProgress ? (
              <div
                className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-[12px] font-semibold"
                style={{ background: '#3b82f620', color: PIN_COLOR }}
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Geocodificando endereços…{' '}
                {geocodeProgress.done}/{geocodeProgress.total}
              </div>
            ) : pendingCount > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleGeocode}
                loading={geocoding}
                leftIcon={<Navigation className="w-3.5 h-3.5" />}
              >
                Geocodificar {pendingCount} endereço{pendingCount !== 1 ? 's' : ''}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadSummary()}
              loading={loading}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              Atualizar
            </Button>
          </div>
        </div>

        {/* Barra de progresso de geocodificação */}
        {geocoding && geocodeProgress && geocodeProgress.total > 0 && (
          <div className="mt-3">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[11px] font-semibold" style={{ color: PIN_COLOR }}>
                Mapeando endereços para o mapa...
              </span>
              <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-3)' }}>
                {Math.round((geocodeProgress.done / geocodeProgress.total) * 100)}%
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.round((geocodeProgress.done / geocodeProgress.total) * 100)}%`,
                  background: PIN_COLOR,
                }}
              />
            </div>
          </div>
        )}

        {/* Stats rápidas */}
        {pinStats && (
          <div className="mt-3 flex flex-wrap gap-4">
            {[
              { label: 'Com endereço', value: pinStats.withFullAddress, color: 'var(--text-2)' },
              { label: 'Mapeados (exatos)', value: pinStats.pinsMapped, color: '#3b82f6' },
              { label: 'Aproximados (cidade)', value: pinStats.pinsApproximate, color: '#f59e0b' },
              { label: 'Sem coordenadas', value: pinStats.pinsPending, color: '#ef4444' },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                  {s.label}:{' '}
                  <strong style={{ color: s.color }}>{s.value?.toLocaleString('pt-BR') ?? '—'}</strong>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      </>
      )}

      {/* ── Barra de busca ── */}
      <div
        className="px-4 py-3 border-b"
        style={{
          borderColor: embedded ? 'rgba(255,255,255,0.06)' : 'var(--border-subtle)',
          background: embedded ? 'transparent' : 'var(--surface-1)',
        }}
      >
        <div className="relative max-w-[480px]">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
            style={{ color: 'var(--text-3)' }}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar contato pelo nome e navegar no mapa..."
            className="w-full pl-9 pr-8 py-2 rounded-xl text-[13px] bg-transparent outline-none"
            style={{
              background: 'var(--surface-0)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
          />
          {search && (
            <button
              onClick={() => { setSearch(''); setSearchResults([]); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2"
            >
              <X className="w-3.5 h-3.5" style={{ color: 'var(--text-3)' }} />
            </button>
          )}

          {/* Dropdown de resultados */}
          {(searchResults.length > 0 || searchLoading) && search.trim().length >= 2 && (
            <div
              className="absolute left-0 right-0 top-full mt-1 z-[9999] rounded-xl overflow-hidden shadow-2xl"
              style={{ background: 'var(--surface-0)', border: '1px solid var(--border)' }}
            >
              {searchLoading ? (
                <div className="flex items-center gap-2 px-4 py-3">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--brand)' }} />
                  <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>Buscando...</span>
                </div>
              ) : (
                <ul className="max-h-[260px] overflow-y-auto">
                  {searchResults.map((pin) => {
                    const hasCoords = isMapCoordValid(pin.lat, pin.lng);
                    return (
                      <li key={pin.id}>
                        <button
                          type="button"
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-1)]"
                          onClick={() => flyToPin(pin)}
                        >
                          <MapPin
                            className="w-4 h-4 shrink-0"
                            style={{ color: hasCoords ? PIN_COLOR : '#9ca3af' }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                              {pin.name}
                            </div>
                            <div className="text-[11px] truncate" style={{ color: 'var(--text-3)' }}>
                              {[pin.street && pin.number ? `${pin.street}, ${pin.number}` : pin.street, pin.city, pin.state]
                                .filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          {hasCoords
                            ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                            : <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                          }
                          <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-3)' }} />
                        </button>
                      </li>
                    );
                  })}
                  {searchResults.length === 0 && (
                    <li className="px-4 py-3 text-[12px]" style={{ color: 'var(--text-3)' }}>
                      Nenhum contato geocodificado encontrado para "{search}"
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>

        {selectedPin && (
          <div
            className="mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold"
            style={{ background: '#3b82f620', color: PIN_COLOR }}
          >
            <MapPin className="w-3 h-3" />
            Focado em: {selectedPin.name}
            <button onClick={() => { setSelectedPin(null); mapRef.current?.flyTo(BR_CENTER, BR_ZOOM); }}>
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* ── Mapa ── */}
      <div className="relative">
        {loading && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3"
            style={{ background: 'var(--surface-0)', opacity: 0.9 }}
          >
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--brand)' }} />
            <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>Carregando mapa...</p>
          </div>
        )}
        {error && !loading && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center"
            style={{ background: 'var(--surface-0)', opacity: 0.95 }}
          >
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>{error}</p>
            <Button variant="secondary" size="sm" onClick={() => void loadSummary()}>
              Tentar novamente
            </Button>
          </div>
        )}

        <div
          ref={mapContainerRef}
          style={{ height: embedded ? '400px' : '480px', width: '100%', zIndex: 0 }}
        />
      </div>

      {!embedded && (
      <>
      {/* ── Legenda ── */}
      <div
        className="px-5 py-2.5 border-t flex flex-wrap items-center gap-4"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
      >
        {[
          { color: PIN_COLOR, label: 'Endereço exato (rua/CEP)' },
          { color: APPROX_COLOR, label: 'Aproximado (cidade)' },
          { color: CLUSTER_COLOR, label: 'Cluster de cidade (múltiplos)' },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: l.color }} />
            <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{l.label}</span>
          </div>
        ))}
        <span className="ml-auto text-[10px]" style={{ color: 'var(--text-3)' }}>
          © OpenStreetMap contributors
        </span>
      </div>

      {/* ── Painel de inteligência de endereços ── */}
      <div className="p-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <AddressIntelligencePanel
          pendingGeocode={pendingCount}
          withAddress={pinStats?.withFullAddress ?? 0}
          onAddressesFixed={() => {
            autoGeocodeRef.current = false;
            void loadSummary();
          }}
        />
      </div>
      </>
      )}
    </div>
  );
};
