import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { apiFetchJson } from '../../../utils/apiFetchAuth';

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
        `/api/contacts/city-suggest?q=${encodeURIComponent(q.trim())}&limit=12`
      );
      const list = data.ok && Array.isArray(data.suggestions) ? data.suggestions : [];
      setSuggestions(list);
      setOpen(list.length > 0);
    } catch {
      setSuggestions([]);
      setOpen(false);
    } finally {
      setSearching(false);
    }
  }, []);

  const resolveAndApply = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.length < 2) return;

      try {
        const data = await apiFetchJson<{
          ok: boolean;
          resolved: { city: string; state: string; label: string } | null;
        }>(`/api/contacts/city-resolve?q=${encodeURIComponent(trimmed)}`);
        if (data.ok && data.resolved?.label) {
          setDraft(data.resolved.label);
          setOpen(false);
          await onApply(data.resolved.label);
          return;
        }
      } catch {
        /* fallback abaixo */
      }

      if (trimmed.length >= 3) {
        setOpen(false);
        await onApply(trimmed);
      }
    },
    [onApply]
  );

  const onDraftChange = (next: string) => {
    setDraft(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchSuggestions(next), 280);
  };

  return (
    <div ref={rootRef} className="zm-atlas-search">
      <Search className="zm-atlas-search__icon" aria-hidden />
      <input
        type="search"
        value={draft}
        disabled={disabled || saving}
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
        placeholder="Blumenau - SC"
        autoComplete="off"
        aria-label="Cidade do mapa territorial"
      />
      {(searching || saving) && <Loader2 className="zm-atlas-search__spinner animate-spin" aria-hidden />}
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
                    void onApply(label);
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
