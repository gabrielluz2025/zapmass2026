import React, { useCallback, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  DEFAULT_CAMPAIGN_GREETINGS,
  loadCampaignGreetings,
  saveCampaignGreetings
} from '../../utils/campaignGreetings';

type Props = {
  onInsert: (text: string) => void;
};

export const CampaignGreetingPicker: React.FC<Props> = ({ onInsert }) => {
  const [greetings, setGreetings] = useState<string[]>(() => loadCampaignGreetings());
  const [draft, setDraft] = useState('');

  const persist = useCallback((next: string[]) => {
    setGreetings(next);
    saveCampaignGreetings(next);
  }, []);

  const addGreeting = () => {
    const t = draft.trim();
    if (!t) return;
    if (greetings.some((g) => g.toLowerCase() === t.toLowerCase())) {
      setDraft('');
      return;
    }
    persist([...greetings, t]);
    setDraft('');
  };

  const removeGreeting = (g: string) => {
    const next = greetings.filter((x) => x !== g);
    persist(next.length > 0 ? next : [...DEFAULT_CAMPAIGN_GREETINGS]);
  };

  return (
    <div className="cw-greeting-picker">
      <p className="cw-vars-group-label">Saudações (insere no texto)</p>
      <div className="flex flex-wrap gap-1 mb-2">
        {greetings.map((g) => (
          <span key={g} className="inline-flex items-center gap-0.5">
            <button
              type="button"
              className="cw-vars-chip cw-vars-chip--greeting"
              onClick={() => onInsert(g.endsWith(' ') ? g : `${g} `)}
              title={`Inserir "${g}"`}
            >
              {g}
            </button>
            <button
              type="button"
              className="cw-greeting-remove"
              aria-label={`Remover saudação ${g}`}
              onClick={() => removeGreeting(g)}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          className="flex-1 rounded-lg border px-2.5 py-1.5 text-[12px]"
          style={{
            borderColor: 'var(--border-subtle)',
            background: 'var(--surface-0)',
            color: 'var(--text-1)'
          }}
          placeholder="Nova saudação (ex: Paz, Hey)"
          value={draft}
          maxLength={32}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addGreeting();
            }
          }}
        />
        <button
          type="button"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-1)'
          }}
          onClick={addGreeting}
        >
          <Plus className="w-3.5 h-3.5" />
          Criar
        </button>
      </div>
    </div>
  );
};
