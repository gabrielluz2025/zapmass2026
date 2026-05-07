import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, UserMinus, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { getAuth } from 'firebase/auth';
import { Badge, Button } from '../ui';

const apiFetch = async (path: string, init?: RequestInit) => {
  const u = getAuth().currentUser;
  if (!u) throw new Error('Sessão expirada. Entre novamente.');
  const token = await u.getIdToken();
  const r = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {})
    }
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!r.ok) throw new Error(j.error || `Erro HTTP ${r.status}`);
  return j;
};

export type WorkspaceMemberRow = {
  uid: string;
  source: 'invite' | 'password';
  loginSlug: string | null;
  email: string | null;
  displayName: string | null;
  linkedAt: string | null;
};

type Props = {
  enabled: boolean;
  /** Incremente para forçar recarregar após criar/revogar noutros painéis. */
  reloadToken: number;
  onRevoked?: () => void;
};

function formatLinked(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(d);
}

export const WorkspaceActiveMembersCard: React.FC<Props> = ({ enabled, reloadToken, onRevoked }) => {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<WorkspaceMemberRow[]>([]);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const j = (await apiFetch('/api/workspace/members')) as { ok?: boolean; items?: WorkspaceMemberRow[] };
      setRows(Array.isArray(j.items) ? j.items : []);
    } catch {
      toast.error('Não foi possível carregar membros da equipa.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const revoke = async (row: WorkspaceMemberRow) => {
    const label = row.displayName || row.loginSlug || row.email || 'este membro';
    const verb = row.source === 'password' ? 'revoga o login por senha' : 'remove o vínculo do convite';
    if (!confirm(`Tem certeza? Isto ${verb} de ${label} e pode desconectar sessões.`)) return;
    setBusyUid(row.uid);
    try {
      if (row.source === 'password') {
        await apiFetch(`/api/workspace/staff-password-users/${encodeURIComponent(row.uid)}`, {
          method: 'DELETE'
        });
      } else {
        await apiFetch(`/api/workspace/member/${encodeURIComponent(row.uid)}`, {
          method: 'DELETE'
        });
      }
      toast.success(row.source === 'password' ? 'Acesso por senha revogado.' : 'Membro removido.');
      onRevoked?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao remover.');
    } finally {
      setBusyUid(null);
    }
  };

  if (!enabled) return null;

  return (
    <div
      className="rounded-2xl p-5 sm:p-6 border space-y-4 mb-5"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--brand-600)' }}
        >
          <Users className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold leading-snug" style={{ color: 'var(--text-1)' }}>
            Equipa com acesso agora
          </h2>
          <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Quem já está ligado ao seu espaço ZapMass — por convite (Google OAuth) ou por usuário e senha criado nesta conta.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] py-2" style={{ color: 'var(--text-3)' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> A carregar…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
          Ainda não há membros ligados. Adicione alguém com um convite ou com usuário e senha abaixo.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const main = row.displayName || row.email || row.uid.slice(0, 12) + '…';
            return (
              <li
                key={row.uid}
                className="flex flex-wrap items-start justify-between gap-2 rounded-xl px-3 py-3 text-[13px]"
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold truncate max-w-[220px]" style={{ color: 'var(--text-1)' }}>
                      {main}
                    </span>
                    <Badge variant={row.source === 'password' ? 'info' : 'success'} className="text-[10px] uppercase">
                      {row.source === 'password' ? 'Senha' : 'Convite'}
                    </Badge>
                  </div>
                  <div className="text-[12px] space-y-0.5" style={{ color: 'var(--text-2)' }}>
                    {row.loginSlug && (
                      <p>
                        Usuário: <span className="font-mono">@{row.loginSlug}</span>
                      </p>
                    )}
                    {row.email && !row.loginSlug && (
                      <p className="truncate max-w-full" title={row.email}>
                        {row.email}
                      </p>
                    )}
                    <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                      Ligado desde {formatLinked(row.linkedAt)}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busyUid !== null}
                  leftIcon={
                    busyUid === row.uid ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <UserMinus className="w-3.5 h-3.5" />
                    )
                  }
                  className="text-red-600 hover:text-red-700 shrink-0 dark:text-red-400"
                  onClick={() => void revoke(row)}
                >
                  Revogar
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
