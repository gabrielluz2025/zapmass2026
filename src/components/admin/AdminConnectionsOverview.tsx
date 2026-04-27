import React, { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { RefreshCw, Shield, Trash2, Users } from 'lucide-react';
import { Card, CardHeader, Badge, Button } from '../ui';
import { ConnectionStatus } from '../../types';

type Row = {
  id: string;
  localId: string;
  name: string;
  status: string;
  lastActivity: string;
  phoneNumber: string | null;
  ownerUid: string | null;
  canRevoke: boolean;
};

const statusLabel = (s: string): string => {
  const u = s.toUpperCase();
  if (u === ConnectionStatus.CONNECTED) return 'Ligada';
  if (u === ConnectionStatus.QR_READY) return 'Aguarda QR';
  if (u === ConnectionStatus.CONNECTING) return 'A ligar';
  if (u === ConnectionStatus.DISCONNECTED) return 'Desligada';
  if (u === ConnectionStatus.SUSPENDED) return 'Suspensa';
  if (u === ConnectionStatus.BUSY) return 'Ocupada';
  return s;
};

const statusVariant = (s: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  const u = s.toUpperCase();
  if (u === ConnectionStatus.CONNECTED) return 'success';
  if (u === ConnectionStatus.QR_READY || u === ConnectionStatus.CONNECTING) return 'warning';
  if (u === ConnectionStatus.DISCONNECTED) return 'neutral';
  return 'danger';
};

export const AdminConnectionsOverview: React.FC<{ user: User | null }> = ({ user }) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [onlyPending, setOnlyPending] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const token = await user.getIdToken();
      const r = await fetch('/api/admin/connections-overview', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const j = (await r.json()) as { ok?: boolean; error?: string; connections?: Row[] };
      if (!r.ok) {
        setErr(j.error || `HTTP ${r.status}`);
        setRows([]);
        return;
      }
      setRows(Array.isArray(j.connections) ? j.connections : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha de rede');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    if (!user) return;
    const row = rows.find((r) => r.id === id);
    if (!row?.canRevoke) return;
    const ok = window.confirm(
      'Isto remove o canal do servidor (para o browser/QR) e apaga a entrada. ' +
        'Não podes fazer isto a uma conexão já ligada ao WhatsApp. Continuar?'
    );
    if (!ok) return;
    setActionId(id);
    setErr(null);
    try {
      const token = await user.getIdToken();
      const r = await fetch('/api/admin/connections/revoke-pending', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok) {
        setErr(j.error || `HTTP ${r.status}`);
        return;
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha ao remover');
    } finally {
      setActionId(null);
    }
  };

  if (!user) return null;

  const filtered = onlyPending
    ? rows.filter((r) => r.status.toUpperCase() !== ConnectionStatus.CONNECTED)
    : rows;

  return (
    <Card className="overflow-hidden mt-5">
      <div className="p-1">
        <CardHeader
          icon={
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--semantic-info-tint)' }}>
              <Users className="w-[18px] h-[18px] text-indigo-500" aria-hidden />
            </div>
          }
          title="Conexões (todos os utilizadores)"
          subtitle="Lista o estado no servidor. Só podes “Encerrar” linhas que ainda não estão com WhatsApp ligado (não uses em contas ativas ligadas ao QR com sucesso)."
          actions={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={loading}
              onClick={load}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" aria-hidden />}
            >
              Atualizar
            </Button>
          }
        />
      </div>
      <div className="px-4 pb-2 flex flex-wrap items-center gap-2 text-[12px]">
        <label className="inline-flex items-center gap-2 cursor-pointer" style={{ color: 'var(--text-2)' }}>
          <input type="checkbox" className="rounded" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
          Mostrar só conexões que não estão com WhatsApp ligado
        </label>
        <Badge variant="info" className="text-[10px]">
          <Shield className="w-3 h-3 mr-1 inline" aria-hidden />
          Admin
        </Badge>
      </div>
      {err && (
        <div className="mx-4 mb-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: 'var(--semantic-danger-bg)', color: 'var(--text-2)' }} role="alert">
          {err}
        </div>
      )}
      <div className="px-2 pb-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[12px]">
          <thead>
            <tr style={{ color: 'var(--text-3)' }}>
              <th className="py-2 pr-2 font-semibold">Utilizador (UID)</th>
              <th className="py-2 pr-2 font-semibold">Canal</th>
              <th className="py-2 pr-2 font-semibold">Estado</th>
              <th className="py-2 pr-2 font-semibold">Telefone</th>
              <th className="py-2 pr-2 font-semibold">Atividade</th>
              <th className="py-2 pl-2 font-semibold w-[120px]">Ação</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center" style={{ color: 'var(--text-3)' }}>
                  {rows.length === 0
                    ? 'Nenhuma conexão no servidor (ou ainda a carregar).'
                    : 'Nada neste filtro.'}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr
                  key={r.id}
                  className="border-t"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <td className="py-2 pr-2 font-mono text-[10px] max-w-[200px] truncate" title={r.ownerUid || 'legado'}>
                    {r.ownerUid || '— (legado)'}
                  </td>
                  <td className="py-2 pr-2">
                    <div className="font-medium" style={{ color: 'var(--text-1)' }}>{r.name}</div>
                    <div className="text-[10px] font-mono truncate max-w-[180px]" style={{ color: 'var(--text-3)' }} title={r.id}>
                      {r.localId}
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <Badge variant={statusVariant(r.status)} className="text-[10px]">
                      {statusLabel(r.status)}
                    </Badge>
                  </td>
                  <td className="py-2 pr-2 font-mono text-[11px]">{r.phoneNumber || '—'}</td>
                  <td className="py-2 pr-2" style={{ color: 'var(--text-3)' }}>{r.lastActivity}</td>
                  <td className="py-2 pl-2">
                    {r.canRevoke ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        className="!text-[10px] !px-2 !py-1"
                        loading={actionId === r.id}
                        disabled={actionId !== null}
                        leftIcon={<Trash2 className="w-3 h-3" aria-hidden />}
                        onClick={() => void revoke(r.id)}
                      >
                        Encerrar
                      </Button>
                    ) : (
                      <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>Ligada — bloqueado</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
