import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiFetchJson } from '../../../utils/apiFetchAuth';
import { resolveCityLabelOffline } from '../../../utils/clientCityResolve';

type CitySuggestion = { city: string; state: string };

function formatCityLabel(city: string, state: string): string {
  return `${city} · ${state}`;
}

type Props = {
  value: string;
  disabled?: boolean;
  saving?: boolean;
  onApply: (cityLabel: string) => void | Promise<void>;
};

/** Input compacto de cidade — focal da toolbar (sem card de região/GPS). */
export const TerritoryCitySearch: React.FC<Props> = ({
  value,
  disabled = false,
  saving = false,
  onApply,
}) => {
  const [draft, setDraft] = useState(value);
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([]);
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
    if (!q || q.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    setSearching(true);
    try {
      const data = await apiFetchJson<{ ok: boolean; suggestions: CitySuggestion[] }>(
        `/api/geo/city-suggest?q=${encodeURIComponent(q.trim())}&limit=12`
      );
      const list = data.ok && Array.isArray(data.suggestions) ? data.suggestions : [];
      setSuggestions(list);
      setOpen(list.length > 0);
    } catch {
      const offline = resolveCityLabelOffline(q);
      if (offline) {
        const parts = offline.split('·').map((p) => p.trim());
        setSuggestions([{ city: parts[0] || offline, state: parts[1] || '' }]);
        setOpen(true);
      } else {
        setSuggestions([]);
        setOpen(false);
      }
    } finally {
      setSearching(false);
    }
  }, []);

  const resolveLabel = useCallback(async (raw: string): Promise<string | null> => {
    const trimmed = raw.trim();
    if (trimmed.length < 2) return null;

    try {
      const data = await apiFetchJson<{
        ok: boolean;
        resolved: { city: string; state: string; label: string } | null;
      }>(`/api/geo/city-resolve?q=${encodeURIComponent(trimmed)}`);
      if (data.ok && data.resolved?.label) return data.resolved.label;
    } catch {
      /* offline abaixo */
    }
    return resolveCityLabelOffline(trimmed);
  }, []);

  const resolveAndApply = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.length < 2) return;

      setApplying(true);
      try {
        const label = await resolveLabel(trimmed);
        if (!label) {
          toast.error('Cidade não encontrada. Use o formato: Indaial - SC');
          return;
        }
        if (label === value.trim()) return;
        setDraft(label);
        setOpen(false);
        await onApply(label);
        toast.success(`Cidade: ${label}`);
      } finally {
        setApplying(false);
      }
    },
    [onApply, resolveLabel, value]
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
        onFocus={() => suggestions.length > 0 && setOpen(true)}
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
        placeholder="Indaial - SC"
        autoComplete="off"
        aria-label="Cidade do mapa territorial"
      />
      {busy && <Loader2 className="zm-atlas-search__spinner animate-spin" aria-hidden />}
      {open && suggestions.length > 0 && (
        <ul className="zm-atlas-search__dropdown" role="listbox">
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
                        await onApply(label);
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
