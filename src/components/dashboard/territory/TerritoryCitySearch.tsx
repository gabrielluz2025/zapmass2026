import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiFetchJson } from '../../../utils/apiFetchAuth';
import { resolveCityLabelOffline } from '../../../utils/clientCityResolve';
import {
  formatStateLabel,
  resolveBrazilStateCode,
  searchBrazilStates,
  type TerritoryRegionApply,
} from '../../../utils/territoryRegionFilter';

type CitySuggestion = { city: string; state: string };

function formatCityLabel(city: string, state: string): string {
  return `${city} · ${state}`;
}

type Props = {
  value: string;
  mode: 'city' | 'state';
  disabled?: boolean;
  saving?: boolean;
  onApply: (region: TerritoryRegionApply) => void | Promise<void>;
};

/** Busca cidade ou estado (UF) para o atlas territorial. */
export const TerritoryCitySearch: React.FC<Props> = ({
  value,
  mode,
  disabled = false,
  saving = false,
  onApply,
}) => {
  const [draft, setDraft] = useState(value);
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([]);
  const [stateSuggestions, setStateSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [applying, setApplying] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const skipBlurApply = useRef(false);

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const fetchSuggestions = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || trimmed.length < 2) {
      setSuggestions([]);
      setStateSuggestions([]);
      setOpen(false);
      return;
    }

    const states = searchBrazilStates(trimmed, 6);
    setStateSuggestions(states.map((s) => formatStateLabel(s)));

    setSearching(true);
    try {
      const data = await apiFetchJson<{ ok: boolean; suggestions: CitySuggestion[] }>(
        `/api/geo/city-suggest?q=${encodeURIComponent(trimmed)}&limit=12`
      );
      const list = data.ok && Array.isArray(data.suggestions) ? data.suggestions : [];
      setSuggestions(list);
      setOpen(list.length > 0 || states.length > 0);
    } catch {
      const offline = resolveCityLabelOffline(trimmed);
      if (offline) {
        const parts = offline.split('·').map((p) => p.trim());
        setSuggestions([{ city: parts[0] || offline, state: parts[1] || '' }]);
        setOpen(true);
      } else if (states.length > 0) {
        setSuggestions([]);
        setOpen(true);
      } else {
        setSuggestions([]);
        setOpen(false);
      }
    } finally {
      setSearching(false);
    }
  }, []);

  const resolveRegion = useCallback(async (raw: string): Promise<TerritoryRegionApply | null> => {
    const trimmed = raw.trim();
    if (trimmed.length < 2) return null;

    const looksLikeCity = /[-·,]/.test(trimmed) || trimmed.split(/\s+/).length >= 2 && trimmed.length > 3;

    if (!looksLikeCity) {
      const uf = resolveBrazilStateCode(trimmed);
      if (uf) return { mode: 'state', state: uf, label: formatStateLabel(uf) };
    }

    try {
      const data = await apiFetchJson<{
        ok: boolean;
        resolved: { city: string; state: string; label: string } | null;
      }>(`/api/geo/city-resolve?q=${encodeURIComponent(trimmed)}`);
      if (data.ok && data.resolved?.label) {
        return { mode: 'city', label: data.resolved.label };
      }
    } catch {
      /* offline */
    }

    const offline = resolveCityLabelOffline(trimmed);
    if (offline) return { mode: 'city', label: offline };

    const uf = resolveBrazilStateCode(trimmed);
    if (uf) return { mode: 'state', state: uf, label: formatStateLabel(uf) };

    return null;
  }, []);

  const resolveAndApply = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.length < 2) return;

      setApplying(true);
      try {
        const region = await resolveRegion(trimmed);
        if (!region) {
          toast.error('Região não encontrada. Use cidade (Indaial - SC) ou estado (SC, Santa Catarina).');
          return;
        }
        if (region.label === value.trim() && region.mode === mode) return;
        setDraft(region.label);
        setOpen(false);
        await onApply(region);
        toast.success(region.mode === 'state' ? `Estado: ${region.label}` : `Cidade: ${region.label}`);
      } finally {
        setApplying(false);
      }
    },
    [mode, onApply, resolveRegion, value]
  );

  const onDraftChange = (next: string) => {
    setDraft(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchSuggestions(next), 400);
  };

  const busy = searching || saving || applying;

  return (
    <div ref={rootRef} className="zm-atlas-search">
      <Search className="zm-atlas-search__icon" aria-hidden />
      <input
        type="search"
        value={draft}
        disabled={disabled || busy}
        onChange={(e) => onDraftChange(e.target.value)}
        onFocus={() => (suggestions.length > 0 || stateSuggestions.length > 0) && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void resolveAndApply(draft);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
        onBlur={() => {
          if (skipBlurApply.current) {
            skipBlurApply.current = false;
            return;
          }
          if (draft.trim() !== value.trim()) {
            void resolveAndApply(draft);
          }
        }}
        className="zm-atlas-search__input"
        placeholder="Cidade ou estado (SC, Indaial - SC)"
        autoComplete="off"
        aria-label="Cidade ou estado do mapa territorial"
      />
      {busy && <Loader2 className="zm-atlas-search__spinner animate-spin" aria-hidden />}
      {open && (stateSuggestions.length > 0 || suggestions.length > 0) && (
        <ul className="zm-atlas-search__dropdown" role="listbox">
          {stateSuggestions.map((label) => {
            const uf = label.split('·').pop()?.trim() || label;
            return (
              <li key={`uf-${uf}`}>
                <button
                  type="button"
                  className="zm-atlas-search__option zm-atlas-search__option--state"
                  onMouseDown={() => {
                    skipBlurApply.current = true;
                    setDraft(label);
                    setOpen(false);
                    void (async () => {
                      setApplying(true);
                      try {
                        const code = resolveBrazilStateCode(uf);
                        if (!code) return;
                        await onApply({ mode: 'state', state: code, label });
                        toast.success(`Estado: ${label}`);
                      } finally {
                        setApplying(false);
                      }
                    })();
                  }}
                >
                  <span>{label}</span>
                  <span className="zm-atlas-search__uf">Estado</span>
                </button>
              </li>
            );
          })}
          {suggestions.map((s) => {
            const label = formatCityLabel(s.city, s.state);
            return (
              <li key={`${s.city}-${s.state}`}>
                <button
                  type="button"
                  className="zm-atlas-search__option"
                  onMouseDown={() => {
                    skipBlurApply.current = true;
                    setDraft(label);
                    setOpen(false);
                    void (async () => {
                      setApplying(true);
                      try {
                        await onApply({ mode: 'city', label });
                        toast.success(`Cidade: ${label}`);
                      } finally {
                        setApplying(false);
                      }
                    })();
                  }}
                >
                  <span>{s.city}</span>
                  <span className="zm-atlas-search__uf">{s.state}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
