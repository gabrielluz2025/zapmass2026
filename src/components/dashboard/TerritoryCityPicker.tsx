import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Crosshair, Loader2, MapPin, Search } from 'lucide-react';
import { apiFetchJson } from '../../utils/apiFetchAuth';
import type { OperatingLocationSource } from '../../services/operatingLocationApi';

type CitySuggestion = { city: string; state: string };

function formatCityLabel(city: string, state: string): string {
  return `${city} · ${state}`;
}

type Props = {
  value: string;
  source?: OperatingLocationSource;
  loading?: boolean;
  saving?: boolean;
  gpsLoading?: boolean;
  presets?: string[];
  onApply: (cityLabel: string) => void | Promise<void>;
  onGps?: () => void;
  disabled?: boolean;
};

export const TerritoryCityPicker: React.FC<Props> = ({
  value,
  source,
  loading = false,
  saving = false,
  gpsLoading = false,
  presets = [],
  onApply,
  onGps,
  disabled = false,
}) => {
  const [draft, setDraft] = useState(value);
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (!q || q.trim().length < 2) {
      setSuggestions([]);
      setDropdownOpen(false);
      return;
    }
    setSearching(true);
    try {
      const data = await apiFetchJson<{ ok: boolean; suggestions: CitySuggestion[] }>(
        `/api/contacts/city-suggest?q=${encodeURIComponent(q.trim())}&limit=8`
      );
      const list = data.ok && Array.isArray(data.suggestions) ? data.suggestions : [];
      setSuggestions(list);
      setDropdownOpen(list.length > 0);
    } catch {
      setSuggestions([]);
      setDropdownOpen(false);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleDraftChange = (next: string) => {
    setDraft(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchSuggestions(next);
    }, 320);
  };

  const pickSuggestion = (s: CitySuggestion) => {
    const label = formatCityLabel(s.city, s.state);
    setDraft(label);
    setDropdownOpen(false);
    setSuggestions([]);
    void onApply(label);
  };

  const handleApply = () => {
    const trimmed = draft.trim();
    if (trimmed.length < 3) return;
    setDropdownOpen(false);
    void onApply(trimmed);
  };

  const busy = loading || saving || gpsLoading;

  return (
    <div ref={rootRef} className="zm-territory-picker">
      <div className="zm-territory-picker__head">
        <div className="zm-territory-picker__icon-wrap">
          <MapPin className="w-4 h-4" />
        </div>
        <div className="zm-territory-picker__copy">
          <p className="zm-territory-picker__label">Região do mapa</p>
          <p className="zm-territory-picker__hint">
            {loading
              ? 'Carregando região salva…'
              : source === 'gps'
                ? 'GPS pode errar em desktop — confira e escolha a cidade abaixo.'
                : source === 'ip'
                  ? 'Detectado pela rede (aproximado) — ajuste se necessário.'
                  : 'Busque a cidade ou escolha uma sugestão IBGE.'}
          </p>
        </div>
      </div>

      <div className="zm-territory-picker__row">
        <div className="zm-territory-picker__field">
          <Search className="zm-territory-picker__search-icon" />
          <input
            value={draft}
            disabled={disabled || busy}
            onChange={(e) => handleDraftChange(e.target.value)}
            onFocus={() => {
              if (suggestions.length > 0) setDropdownOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleApply();
              }
              if (e.key === 'Escape') setDropdownOpen(false);
            }}
            className="zm-territory-picker__input"
            placeholder="Digite cidade ou UF — ex: Blumenau, São Paulo…"
            autoComplete="off"
          />
          {(searching || saving) && (
            <Loader2 className="zm-territory-picker__field-spinner animate-spin" />
          )}
          <ChevronDown className="zm-territory-picker__chevron" />
        </div>

        <button
          type="button"
          className="zm-territory-picker__apply"
          disabled={disabled || busy || draft.trim().length < 3}
          onClick={handleApply}
        >
          <Check className="w-3.5 h-3.5" />
          Aplicar
        </button>

        {onGps && (
          <button
            type="button"
            className="zm-territory-picker__gps"
            disabled={disabled || busy}
            onClick={onGps}
            title="Tentar GPS do dispositivo (pode ser impreciso no computador)"
          >
            {gpsLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Crosshair className="w-3.5 h-3.5" />
            )}
            GPS
          </button>
        )}
      </div>

      {dropdownOpen && suggestions.length > 0 && (
        <ul className="zm-territory-picker__dropdown" role="listbox">
          {suggestions.map((s) => {
            const label = formatCityLabel(s.city, s.state);
            return (
              <li key={`${s.city}-${s.state}`}>
                <button type="button" className="zm-territory-picker__option" onClick={() => pickSuggestion(s)}>
                  <span className="zm-territory-picker__option-city">{s.city}</span>
                  <span className="zm-territory-picker__option-uf">{s.state}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {presets.length > 0 && (
        <div className="zm-territory-picker__presets">
          {presets.slice(0, 6).map((p) => (
            <button
              key={p}
              type="button"
              className={`zm-territory-picker__chip${value === p ? ' zm-territory-picker__chip--active' : ''}`}
              disabled={disabled || busy}
              onClick={() => void onApply(p)}
            >
              {p.split('·')[0]?.trim() || p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
