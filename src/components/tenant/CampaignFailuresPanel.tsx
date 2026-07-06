import React, { useCallback, useEffect, useState } from 'react';
import { AlertOctagon, Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { fetchCampaignFailures, fetchLegacyDlq, type CampaignFailure } from '../../services/tenantExtrasApi';
import { Card, Button } from '../ui';

/** Falhas definitivas de campanha (DLQ Postgres + legado JSON). */
export const CampaignFailuresPanel: React.FC = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<CampaignFailure[]>([]);
  const [legacy, setLegacy] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const [pg, leg] = await Promise.all([fetchCampaignFailures(token), fetchLegacyDlq(token)]);
      setItems(pg);
      setLegacy(leg);
    } catch {
      toast.error('Não foi possível carregar falhas.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Card className="p-5 flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-3)' }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Carregando falhas de envio…
      </Card>
    );
  }

  if (items.length === 0 && legacy.length === 0) {
    return (
      <Card className="p-5">
        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
          Falhas de campanha (DLQ)
        </p>
        <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>
          Nenhuma mensagem na fila de mortos. Ótimo sinal!
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 text-red-500" />
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>
            Falhas de campanha (DLQ)
          </p>
        </div>
        <Button variant="secondary" size="sm" leftIcon={<RefreshCw className="w-3.5 h-3.5" />} onClick={() => void load()}>
          Atualizar
        </Button>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
        Mensagens que esgotaram tentativas. Revise o número, reconecte o chip ou crie nova campanha só para estes contatos.
      </p>
      {items.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
          <table className="w-full text-[11px]">
            <thead>
              <tr style={{ background: 'var(--surface-1)' }}>
                <th className="text-left p-2 font-semibold">Número</th>
                <th className="text-left p-2 font-semibold">Campanha</th>
                <th className="text-left p-2 font-semibold">Erro</th>
                <th className="text-left p-2 font-semibold">Quando</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.idempotency_key} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="p-2 font-mono">{row.to_number}</td>
                  <td className="p-2 truncate max-w-[120px]" title={row.campaign_id}>
                    {row.campaign_id.slice(0, 12)}…
                  </td>
                  <td className="p-2 text-red-600 max-w-[200px] truncate" title={row.last_error}>
                    {row.last_error || '—'}
                  </td>
                  <td className="p-2 whitespace-nowrap" style={{ color: 'var(--text-3)' }}>
                    {row.updated_at ? new Date(row.updated_at).toLocaleString('pt-BR') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {legacy.length > 0 ? (
        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
          + {legacy.length} registro(s) legado(s) em dead_letter_queue.json (histórico antigo).
        </p>
      ) : null}
    </Card>
  );
};
