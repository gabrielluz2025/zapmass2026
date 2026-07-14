import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionUser } from '../../types/sessionUser';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  UserCog,
  Users
} from 'lucide-react';
import toast from 'react-hot-toast';
import { CollapsibleSection, Badge, Button, StatTile } from '../ui';
import { apiUrl } from '../../utils/apiBase';

type ReconcileAction =
  | {
      kind: 'assign';
      connId: string;
      label: string;
      fromOwnerUid: string | null;
      toOwnerUid: string;
      toEmail: string;
      reason: string;
    }
  | { kind: 'remove'; connId: string; label: string; reason: string };

type OwnerRow = {
  ownerUid: string;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  connectionIds: string[];
  conversationCount: number;
};

type IsolationPayload = {
  ok?: boolean;
  at?: string;
  total?: number;
  orphanCount?: number;
  orphanIds?: string[];
  conversations?: { total: number; orphanCount: number; byOwnerUid: Record<string, number> };
  pendingReconcile?: ReconcileAction[];
  owners?: OwnerRow[];
  connections?: Array<{
    id: string;
    name: string;
    status: string;
    ownerUid: string | null;
    ownerEmail: string | null;
    ownerDisplayName: string | null;
    orphan: boolean;
  }>;
  error?: string;
};

type AccessUser = { uid: string; email: string };

function tenantLabel(row: OwnerRow): string {
  if (row.ownerDisplayName?.trim()) return row.ownerDisplayName.trim();
  if (row.ownerEmail) return row.ownerEmail;
  return row.ownerUid.slice(0, 8) + '…';
}

export const AdminIsolationPanel: React.FC<{ user: SessionUser | null }> = ({ user }) => {
  const [data, setData] = useState<IsolationPayload | null>(null);
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    try {
      const token = await user.getIdToken();
      const [isoRes, usersRes] = await Promise.all([
        fetch(apiUrl('/api/admin/connections-ownership'), {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(apiUrl('/api/admin/access-users'), {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      const iso = (await isoRes.json()) as IsolationPayload;
      if (!isoRes.ok) {
        setErr(iso.error || `HTTP ${isoRes.status}`);
        setData(null);
        return;
      }
      setData(iso);
      if (usersRes.ok) {
        const uj = (await usersRes.json()) as { users?: AccessUser[] };
        setUsers(Array.isArray(uj.users) ? uj.users : []);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha de rede');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const runReconcile = async (dryRun: boolean) => {
    if (!user) return;
    if (!dryRun) {
      const ok = window.confirm(
        'Aplicar reconciliação automática de donos dos canais? Canais podem ser reatribuídos ou removidos conforme o nome do chip.'
      );
      if (!ok) return;
    }
    setReconciling(true);
    try {
      const token = await user.getIdToken();
      const url = dryRun
        ? apiUrl('/api/admin/connections/auto-reconcile?dryRun=1')
        : apiUrl('/api/admin/connections/auto-reconcile');
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun })
      });
      const j = (await r.json()) as {
        ok?: boolean;
        dryRun?: boolean;
        actions?: ReconcileAction[];
        applied?: string[];
        removed?: string[];
        errors?: { connId: string; error: string }[];
        error?: string;
      };
      if (!r.ok) {
        toast.error(j.error || `Falha (HTTP ${r.status})`);
        return;
      }
      if (dryRun) {
        const n = j.actions?.length ?? 0;
        toast.success(n > 0 ? `${n} alteração(ões) proposta(s) — veja a lista abaixo.` : 'Nada a reconciliar.');
      } else {
        const applied = j.applied?.length ?? 0;
        const removed = j.removed?.length ?? 0;
        const errs = j.errors?.length ?? 0;
        if (errs > 0) {
          toast.error(`${applied} aplicado(s), ${removed} removido(s), ${errs} erro(s).`);
        } else {
          toast.success(
            applied + removed > 0
              ? `Reconciliação OK: ${applied} reatribuído(s), ${removed} removido(s).`
              : 'Nenhuma alteração necessária.'
          );
        }
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha de rede');
    } finally {
      setReconciling(false);
    }
  };

  const assignOwner = async (connId: string) => {
    if (!user) return;
    const ownerUid = assignTarget[connId]?.trim();
    if (!ownerUid) {
      toast.error('Escolha o utilizador de destino.');
      return;
    }
    const ok = window.confirm(`Atribuir canal ${connId} ao utilizador selecionado?`);
    if (!ok) return;
    setAssigningId(connId);
    try {
      const token = await user.getIdToken();
      const r = await fetch(apiUrl('/api/admin/connections/reassign-owner'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: connId, ownerUid })
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok) {
        toast.error(j.error || `Falha (HTTP ${r.status})`);
        return;
      }
      toast.success('Dono do canal atualizado.');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha de rede');
    } finally {
      setAssigningId(null);
    }
  };

  const health = useMemo(() => {
    if (!data) return { variant: 'neutral' as const, label: 'A carregar…' };
    const orphans = data.orphanCount ?? 0;
    const convOrphans = data.conversations?.orphanCount ?? 0;
    const pending = data.pendingReconcile?.length ?? 0;
    if (orphans > 0 || convOrphans > 0) {
      return {
        variant: 'danger' as const,
        label: `${orphans} canal(is) órfão(s) · ${convOrphans} conversa(s) sem dono`
      };
    }
    if (pending > 0) {
      return { variant: 'warning' as const, label: `${pending} reconciliação(ões) sugerida(s)` };
    }
    return { variant: 'success' as const, label: 'Isolamento OK' };
  }, [data]);

  const maxConv = useMemo(() => {
    const owners = data?.owners ?? [];
    return Math.max(1, ...owners.map((o) => o.conversationCount));
  }, [data?.owners]);

  if (!user) return null;

  const orphanRows = (data?.connections ?? []).filter((c) => c.orphan);
  const pending = data?.pendingReconcile ?? [];

  return (
    <CollapsibleSection
      id="admin-isolation-panel"
      title="Isolamento entre utilizadores"
      summary={health.label}
      defaultOpen={(data?.orphanCount ?? 0) > 0 || (data?.conversations?.orphanCount ?? 0) > 0}
      actions={
        <div className="flex items-center gap-2">
          <Badge variant={health.variant} dot>
            {health.variant === 'success' ? 'OK' : health.variant === 'warning' ? 'Atenção' : 'Risco'}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={loading}
            onClick={() => void load()}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" aria-hidden />}
          >
            <span className="hidden sm:inline">Atualizar</span>
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {err && (
          <div
            className="rounded-2xl px-4 py-3 text-[12px] flex gap-3"
            style={{ background: 'var(--semantic-danger-bg)', color: 'var(--text-2)' }}
            role="alert"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
            {err}
          </div>
        )}

        {data && (
          <>
            <div className="zm-stat-grid zm-stat-grid--4">
              <StatTile label="Canais no servidor" value={data.total ?? 0} />
              <StatTile
                label="Canais órfãos"
                value={data.orphanCount ?? 0}
                hint="Sem ownerUid em settings"
                warn={(data.orphanCount ?? 0) > 0}
              />
              <StatTile
                label="Conversas no cache"
                value={data.conversations?.total ?? 0}
                hint={`${data.conversations?.orphanCount ?? 0} sem dono resolvível`}
                warn={(data.conversations?.orphanCount ?? 0) > 0}
              />
              <StatTile
                label="Contas com chips"
                value={data.owners?.length ?? 0}
                hint="Utilizadores Postgres"
              />
            </div>

            {(data.orphanCount ?? 0) > 0 || (data.conversations?.orphanCount ?? 0) > 0 ? (
              <div
                className="rounded-xl px-4 py-3 ui-body flex items-start gap-3"
                style={{ background: 'var(--semantic-danger-bg)', color: 'var(--text-2)' }}
              >
                <ShieldAlert className="w-5 h-5 shrink-0" style={{ color: 'var(--semantic-danger-fg)' }} aria-hidden />
                <div>
                  <p className="font-medium" style={{ color: 'var(--text-1)' }}>
                    Risco de conversas visíveis na conta errada
                  </p>
                  <p className="ui-caption mt-1">
                    Atribua donos aos canais órfãos ou execute a reconciliação automática. Após corrigir, peça
                    logout + Ctrl+Shift+R em cada conta.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 ui-caption" style={{ color: 'var(--text-2)' }}>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden />
                Todos os canais têm dono e o cache de conversas está particionado.
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={reconciling}
                disabled={loading}
                onClick={() => void runReconcile(true)}
                leftIcon={<UserCog className="w-3.5 h-3.5" aria-hidden />}
              >
                Simular reconciliação
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={reconciling}
                disabled={loading || pending.length === 0}
                onClick={() => void runReconcile(false)}
              >
                Aplicar reconciliação ({pending.length})
              </Button>
            </div>

            {pending.length > 0 && (
              <div className="zm-panel space-y-2">
                <span className="ui-overline">Reconciliação proposta (automática)</span>
                <ul className="space-y-2 max-h-48 overflow-y-auto">
                  {pending.map((a) => (
                    <li
                      key={`${a.kind}-${a.connId}`}
                      className="rounded-lg px-3 py-2 text-[11px]"
                      style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                    >
                      {a.kind === 'assign' ? (
                        <>
                          <strong style={{ color: 'var(--text-1)' }}>{a.label}</strong>
                          <span className="font-mono ml-1">({a.connId})</span>
                          <br />
                          → {a.toEmail} <span className="opacity-70">({a.reason})</span>
                        </>
                      ) : (
                        <>
                          Remover <strong>{a.label}</strong> ({a.connId}) — {a.reason}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {orphanRows.length > 0 && (
              <div className="zm-panel space-y-3">
                <span className="ui-overline flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
                  Canais órfãos — atribuir manualmente
                </span>
                <ul className="space-y-3">
                  {orphanRows.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2"
                      style={{ background: 'var(--surface-2)' }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[12px]" style={{ color: 'var(--text-1)' }}>
                          {c.name}
                        </div>
                        <div className="font-mono text-[10px] truncate" style={{ color: 'var(--text-3)' }}>
                          {c.id}
                        </div>
                      </div>
                      <select
                        className="rounded-lg border px-2 py-1.5 text-[11px] max-w-[14rem]"
                        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                        value={assignTarget[c.id] ?? ''}
                        onChange={(e) =>
                          setAssignTarget((prev) => ({ ...prev, [c.id]: e.target.value }))
                        }
                      >
                        <option value="">Utilizador…</option>
                        {users.map((u) => (
                          <option key={u.uid} value={u.uid}>
                            {u.email}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        loading={assigningId === c.id}
                        disabled={assigningId !== null && assigningId !== c.id}
                        onClick={() => void assignOwner(c.id)}
                      >
                        Atribuir
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(data.owners?.length ?? 0) > 0 && (
              <div className="zm-panel space-y-3">
                <span className="ui-overline flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" aria-hidden />
                  Distribuição por utilizador (Postgres)
                </span>
                <ul className="space-y-2">
                  {[...(data.owners ?? [])]
                    .sort((a, b) => b.conversationCount - a.conversationCount)
                    .map((o) => {
                      const pct = Math.round((o.conversationCount / maxConv) * 100);
                      return (
                        <li key={o.ownerUid} className="space-y-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px]">
                            <span className="font-medium truncate max-w-[70%]" style={{ color: 'var(--text-1)' }}>
                              {tenantLabel(o)}
                              {o.ownerEmail && o.ownerDisplayName ? (
                                <span className="font-normal ml-1 opacity-70">({o.ownerEmail})</span>
                              ) : null}
                            </span>
                            <span className="tabular-nums shrink-0" style={{ color: 'var(--text-3)' }}>
                              {o.connectionIds.length} chip(s) · {o.conversationCount} conv.
                            </span>
                          </div>
                          <div
                            className="h-1.5 rounded-full overflow-hidden"
                            style={{ background: 'var(--surface-2)' }}
                          >
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${pct}%`, background: 'var(--semantic-info-fg, #06b6d4)' }}
                            />
                          </div>
                        </li>
                      );
                    })}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </CollapsibleSection>
  );
};
