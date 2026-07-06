import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldOff, Trash2, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { addOptOut, fetchOptOutList, removeOptOut, type OptOutRow } from '../../services/tenantExtrasApi';
import { Card, Button } from '../ui';

/** Lista negra global (opt-out) — números que nunca devem receber campanhas. */
export const OptOutManagerPanel: React.FC = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<OptOutRow[]>([]);
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      setItems(await fetchOptOutList(token));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async () => {
    if (!user || !phone.trim()) return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      const ok = await addOptOut(token, phone, reason);
      if (ok) {
        toast.success('Número adicionado à lista negra.');
        setPhone('');
        setReason('');
        void load();
      } else {
        toast.error('Não foi possível adicionar.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (digits: string) => {
    if (!user || !window.confirm('Remover este número da lista negra?')) return;
    const token = await user.getIdToken();
    if (await removeOptOut(token, digits)) {
      toast.success('Removido.');
      void load();
    }
  };

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldOff className="w-4 h-4 text-red-500" />
        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
          Lista negra global (opt-out)
        </p>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
        Números aqui são bloqueados em todas as campanhas. Respostas com SAIR também entram automaticamente via fluxo de resposta.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Telefone com DDD"
          className="flex-1 min-w-[140px] text-[12px] rounded-lg px-3 py-2"
          style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)', color: 'var(--text-1)' }}
        />
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo (opcional)"
          className="flex-1 min-w-[140px] text-[12px] rounded-lg px-3 py-2"
          style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)', color: 'var(--text-1)' }}
        />
        <Button
          variant="primary"
          size="sm"
          leftIcon={saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
          disabled={saving || !phone.trim()}
          onClick={() => void handleAdd()}
        >
          Adicionar
        </Button>
      </div>
      {loading ? (
        <p className="text-[12px] flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
        </p>
      ) : items.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>Nenhum opt-out manual registrado.</p>
      ) : (
        <ul className="max-h-48 overflow-y-auto text-[11px] space-y-1">
          {items.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg"
              style={{ background: 'var(--surface-1)' }}
            >
              <span>
                <strong className="font-mono">{row.phone_digits}</strong>
                {row.reason ? ` — ${row.reason}` : ''}
                <span className="ml-1 opacity-60">({row.source})</span>
              </span>
              <button
                type="button"
                className="p-1 rounded hover:bg-red-500/10 text-red-500"
                title="Remover"
                onClick={() => void handleRemove(row.phone_digits)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};
