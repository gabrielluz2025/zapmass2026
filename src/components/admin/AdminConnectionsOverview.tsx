import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { Copy, Info, RefreshCw, Shield, Unplug, Users } from 'lucide-react';
import toast from 'react-hot-toast';
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

const LEGACY_KEY = '__legacy__';

function shortUid(uid: string | null): string {
  if (!uid) return 'Sem UID (legado)';
  if (uid.length <= 14) return uid;
  return `${uid.slice(0, 6)}…${uid.slice(-4)}`;
}

/** Nome exibido sem repetir o UID (padrão típico: "Canal {uid}__{ref}.backup"). */
function formatChannelName(name: string, ownerUid: string | null): { primary: string; secondary: string } {
  let primary = name.trim();
  if (ownerUid) {
    if (primary.includes(`${ownerUid}__`)) {
      primary = primary.replace(`${ownerUid}__`, 'Ref. ');
    } else {
      primary = primary.split(ownerUid).join('·');
    }
  }
  primary = primary.replace(/\s+/g, ' ').replace(/^Canal Ref\./i, 'Canal · ref.').trim();
  if (/\.backup$/i.test(name)) {
    primary = primary.replace(/\.backup$/i, '').trim() + ' (reserva)';
  }
  if (primary.length > 52) {
    primary = primary.slice(0, 24) + '…' + primary.slice(-20);
  }
  return { primary, secondary: '' };
}

/** Parte legível do ID local (ex.: sufixo após __). */
function compactLocalId(localId: string): string {
  const idx = localId.indexOf('__');
  if (idx >= 0) {
    const tail = localId.slice(idx + 2).replace(/\.backup$/i, '');
    if (tail.length > 16) return `ref …${tail.slice(-10)}`;
    return `ref ${tail}`;
  }
  if (localId.length > 20) return `${localId.slice(0, 8)}…${localId.slice(-6)}`;
  return localId;
}

function countByStatus(rows: Row[], status: string): number {
  const u = status.toUpperCase();
  return rows.filter((r) => r.status.toUpperCase() === u).length;
}

export const AdminConnectionsOverview: React.FC<{ user: User | null }> = ({ user }) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [onlyPending, setOnlyPending] = useState(true);
  const [showHelp, setShowHelp] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    try {
      const token = await user.getIdToken();
      const r = await fetch('/api/admin/connections-overview', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const j = (await r.json()) as { ok?: boolean; error?: string; connections?: Row[] };
      if (!r.ok) {
        setLoadError(j.error || `HTTP ${r.status}`);
        setRows([]);
        return;
      }
      setRows(Array.isArray(j.connections) ? j.connections : []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Falha de rede');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      onlyPending ? rows.filter((r) => r.status.toUpperCase() !== ConnectionStatus.CONNECTED) : rows,
    [rows, onlyPending]
  );

  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, Row[]>();
    for (const r of filtered) {
      const key = r.ownerUid || LEGACY_KEY;
      if (!map.has(key)) {
        order.push(key);
        map.set(key, []);
      }
      map.get(key)!.push(r);
    }
    return order.map((k) => [k, map.get(k)!] as [string, Row[]]);
  }, [filtered]);

  const stats = useMemo(() => {
    const total = rows.length;
    const vis = filtered.length;
    const qr = countByStatus(filtered, ConnectionStatus.QR_READY);
    const conn = countByStatus(filtered, ConnectionStatus.CONNECTING);
    return { total, vis, qr, conn };
  }, [rows.length, filtered]);

  const copyUid = (uid: string) => {
    void navigator.clipboard.writeText(uid).then(
      () => toast.success('UID copiado'),
      () => toast.error('Não foi possível copiar')
    );
  };

  const revoke = async (id: string) => {
    if (!user) return;
    const row = rows.find((r) => r.id === id);
    if (!row?.canRevoke) return;
    const ok = window.confirm(
      'Isto interrompe a sessão de QR / browser neste canal e remove a entrada no servidor. ' +
        'Não uses isto se o WhatsApp já estiver ligado. Continuar?'
    );
    if (!ok) return;
    setActionId(id);
    try {
      const token = await user.getIdToken();
      const r = await fetch('/api/admin/connections/revoke-pending', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok) {
        toast.error(j.error || `Falha (HTTP ${r.status})`, { id: 'revoke-conn' });
        return;
      }
      toast.success('Canal encerrado no servidor');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha de rede', { id: 'revoke-conn' });
    } finally {
      setActionId(null);
    }
  };

  if (!user) return null;

  return (
    <Card className="overflow-hidden mt-5">
      <div className="p-1">
        <CardHeader
          icon={
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--semantic-info-tint)' }}
            >
              <Users className="w-[18px] h-[18px] text-indigo-500" aria-hidden />
            </div>
          }
          title="Conexões — visão global"
          subtitle="Estado das sessões WhatsApp no servidor, por conta. Use “Interromper” só para canais ainda a aguardar QR ou a ligar."
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

      <div
        className="mx-4 mb-2 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[12px]"
        style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
      >
        <span>
          <strong style={{ color: 'var(--text-1)' }}>{stats.vis}</strong> {onlyPending ? 'em aberto' : 'a mostrar'}
          {onlyPending && stats.total > stats.vis ? (
            <span style={{ color: 'var(--text-3)' }}> · {stats.total} no total (ligadas filtradas)</span>
          ) : null}
        </span>
        <span className="text-[var(--text-3)]">·</span>
        <span>QR: {stats.qr}</span>
        <span className="text-[var(--text-3)]">·</span>
        <span>A ligar: {stats.conn}</span>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 text-[11px] underline-offset-2 hover:underline"
          style={{ color: 'var(--text-3)' }}
          onClick={() => setShowHelp((s) => !s)}
        >
          <Info className="w-3.5 h-3.5" aria-hidden />
          {showHelp ? 'Menos' : 'Como funciona'}
        </button>
      </div>

      {showHelp && (
        <div
          className="mx-4 mb-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-3)' }}
        >
          Sessões pendentes aparecem enquanto o utilizador não conclui o QR. “Interromper” cancela essa tentativa
          no servidor. Contas já <strong className="text-[var(--text-2)]">Ligada</strong> ao WhatsApp não podem
          ser forçadas por aqui. O identificador longo (UID) identifica a conta Firebase — pode repetir-se se um
          utilizador tiver vários canais.
        </div>
      )}

      <div className="px-4 pb-2 flex flex-wrap items-center gap-2 text-[12px]">
        <label className="inline-flex items-center gap-2 cursor-pointer" style={{ color: 'var(--text-2)' }}>
          <input
            type="checkbox"
            className="rounded"
            checked={onlyPending}
            onChange={(e) => setOnlyPending(e.target.checked)}
          />
          Esconder contas já ligadas ao WhatsApp
        </label>
        <Badge variant="info" className="text-[10px]">
          <Shield className="w-3 h-3 mr-1 inline" aria-hidden />
          Admin
        </Badge>
      </div>

      {loadError && (
        <div
          className="mx-4 mb-2 rounded-lg px-3 py-2 text-[12px]"
          style={{ background: 'var(--semantic-danger-bg)', color: 'var(--text-2)' }}
          role="alert"
        >
          {loadError}
        </div>
      )}

      <div className="px-2 pb-4 space-y-4">
        {grouped.length === 0 && !loading ? (
          <p className="px-2 py-6 text-center text-[13px]" style={{ color: 'var(--text-3)' }}>
            {rows.length === 0
              ? 'Nenhuma conexão no servidor (ou ainda a carregar).'
              : 'Nada corresponde a este filtro.'}
          </p>
        ) : (
          grouped.map(([key, gRows]) => {
            const isLegacy = key === LEGACY_KEY;
            const displayUid = isLegacy ? null : key;
            return (
              <div
                key={key}
                className="rounded-xl border overflow-hidden"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <div
                  className="flex flex-wrap items-center gap-2 px-3 py-2 text-[11px]"
                  style={{ background: 'var(--surface-1)', color: 'var(--text-2)' }}
                >
                  <span className="font-medium" style={{ color: 'var(--text-1)' }}>
                    {isLegacy ? 'Conta antiga' : 'Conta (Firebase UID)'}
                  </span>
                  {displayUid ? (
                    <>
                      <code className="text-[10px] font-mono max-w-[min(100%,18rem)] truncate" title={displayUid}>
                        {shortUid(displayUid)}
                      </code>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] hover:opacity-90"
                        style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                        onClick={() => copyUid(displayUid)}
                      >
                        <Copy className="w-3 h-3" aria-hidden />
                        Copiar
                      </button>
                    </>
                  ) : (
                    <span className="text-[10px] opacity-80">(IDs antes do modelo com UID no nome)</span>
                  )}
                  <Badge variant="neutral" className="ml-auto text-[10px]">
                    {gRows.length} {gRows.length === 1 ? 'canal' : 'canais'}
                  </Badge>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] text-left text-[12px]">
                    <thead>
                      <tr style={{ color: 'var(--text-3)' }}>
                        <th className="py-2 px-3 font-semibold">Canal</th>
                        <th className="py-2 pr-2 font-semibold w-[120px]">Estado</th>
                        <th className="py-2 pr-2 font-semibold min-w-[160px]">Atividade / número</th>
                        <th className="py-2 px-3 font-semibold w-[150px] text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gRows.map((r) => {
                        const { primary: channelPrimary } = formatChannelName(r.name, r.ownerUid);
                        return (
                          <tr key={r.id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                            <td className="py-2.5 px-3 align-top">
                              <div className="font-medium leading-snug" style={{ color: 'var(--text-1)' }}>
                                {channelPrimary}
                              </div>
                              <div
                                className="mt-1 text-[10px] font-mono"
                                style={{ color: 'var(--text-3)' }}
                                title={r.id}
                              >
                                {compactLocalId(r.localId)}
                              </div>
                            </td>
                            <td className="py-2.5 pr-2 align-top">
                              <Badge variant={statusVariant(r.status)} className="text-[10px] whitespace-nowrap">
                                {statusLabel(r.status)}
                              </Badge>
                            </td>
                            <td className="py-2.5 pr-2 align-top" style={{ color: 'var(--text-2)' }}>
                              <div className="text-[12px]">{r.lastActivity}</div>
                              {r.phoneNumber ? (
                                <div className="mt-0.5 text-[11px] font-mono" style={{ color: 'var(--text-1)' }}>
                                  {r.phoneNumber}
                                </div>
                              ) : (
                                <div className="mt-0.5 text-[10px]" style={{ color: 'var(--text-3)' }}>
                                  Sem nº ainda
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right align-top">
                              {r.canRevoke ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="danger"
                                  className="!text-[10px] !px-2 !py-1"
                                  loading={actionId === r.id}
                                  disabled={actionId !== null}
                                  leftIcon={<Unplug className="w-3 h-3" aria-hidden />}
                                  onClick={() => void revoke(r.id)}
                                >
                                  Interromper
                                </Button>
                              ) : (
                                <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                                  Ligada — não forçar
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
};
