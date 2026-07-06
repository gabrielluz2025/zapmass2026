import React, { useCallback, useEffect, useState } from 'react';
import { Lightbulb, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { fetchMySuggestions, type MySuggestionRow } from '../../services/tenantExtrasApi';
import { Card } from '../ui';

const STATUS_PT: Record<string, string> = {
  received: 'Recebida',
  reviewing: 'Em análise',
  planned: 'Planejada',
  done: 'Implementada',
  declined: 'Não prevista'
};

/** Minhas sugestões enviadas pelo botão Ideias — com status. */
export const MySuggestionsPanel: React.FC = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<MySuggestionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      setItems(await fetchMySuggestions(token));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Card className="p-4 flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-3)' }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Carregando suas ideias…
      </Card>
    );
  }

  if (items.length === 0) return null;

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-amber-500" />
        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
          Minhas sugestões
        </p>
      </div>
      <ul className="space-y-2 max-h-56 overflow-y-auto">
        {items.map((s) => (
          <li
            key={s.id}
            className="text-[11px] p-2.5 rounded-lg"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            <p style={{ color: 'var(--text-1)' }}>{s.text}</p>
            <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5" style={{ color: 'var(--text-3)' }}>
              <span>{STATUS_PT[s.status] || s.status}</span>
              <span>· {new Date(s.created_at).toLocaleDateString('pt-BR')}</span>
              {s.admin_note ? <span className="text-emerald-600">· {s.admin_note}</span> : null}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
};
