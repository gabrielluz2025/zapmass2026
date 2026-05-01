import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { getAuth } from 'firebase/auth';
import { Badge, Button, Input } from '../ui';
import { auth } from '../../services/firebase';
import { STAFF_PASSWORD_ACCOUNTS_FALLBACK_MAX } from '../../constants/workspaceStaff';

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
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; items?: StaffRow[]; max?: number };
  if (!r.ok) throw new Error(j.error || `Erro HTTP ${r.status}`);
  return j;
};

type StaffRow = {
  loginSlug: string;
  displayName: string;
  staffAuthUid: string;
  createdAt: string | null;
  revoked: boolean;
};

type Props = {
  /** Quando true, sem margem superior (usa-se dentro de aba). */
  noTopMargin?: boolean;
};

/**
 * Gestão de funcionários que entram por nome de usuário + senha.
 */
export const StaffPasswordAccountsPanel: React.FC<Props> = ({ noTopMargin }) => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [max, setMax] = useState(STAFF_PASSWORD_ACCOUNTS_FALLBACK_MAX);

  const [displayName, setDisplayName] = useState('');
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const j = (await apiFetch('/api/workspace/staff-password-users')) as {
        ok?: boolean;
        items?: StaffRow[];
        max?: number;
      };
      if (j.items) setRows(j.items);
      if (typeof j.max === 'number') setMax(j.max);
    } catch {
      toast.error('Não foi possível carregar os acessos com senha.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = rows.filter((r) => !r.revoked).length;

  const handleCreate = async () => {
    setBusy(true);
    try {
      await apiFetch('/api/workspace/staff-password-users', {
        method: 'POST',
        body: JSON.stringify({
          displayName: displayName.trim(),
          loginName: loginName.trim().toLowerCase(),
          password
        })
      });
      toast.success('Criado. Passe ao funcionário: seu e-mail (Google), usuário e senha.');
      setLoginName('');
      setPassword('');
      setDisplayName('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (staffAuthUid: string) => {
    if (!staffAuthUid) return;
    if (!confirm('Revogar este acesso?')) return;
    setBusy(true);
    try {
      await apiFetch(`/api/workspace/staff-password-users/${encodeURIComponent(staffAuthUid)}`, {
        method: 'DELETE'
      });
      toast.success('Acesso revogado.');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao revogar.');
    } finally {
      setBusy(false);
    }
  };

  const permanentRemove = async (staffAuthUid: string) => {
    if (!staffAuthUid) return;
    if (!confirm('Remover este registo da lista para sempre? O utilizador já está revogado.')) return;
    setBusy(true);
    try {
      await apiFetch(
        `/api/workspace/staff-password-users/${encodeURIComponent(staffAuthUid)}?purge=true`,
        { method: 'DELETE' }
      );
      toast.success('Removido da lista.');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao apagar.');
    } finally {
      setBusy(false);
    }
  };

  const shell = noTopMargin ? '' : 'mt-8';

  return (
    <div
      className={`rounded-2xl p-5 sm:p-6 border space-y-5 ${shell}`}
      style={{
        borderColor: 'var(--border)',
        background: 'var(--surface-0)',
        boxShadow: 'var(--shadow-xs, 0 1px 2px rgba(0,0,0,0.05))'
      }}
    >
      <div>
        <h3 className="text-[15px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
          Usuário e senha
        </h3>
        <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--text-3)' }}>
          Até <strong>{max}</strong> pessoas. Na entrada do site, elas escolhem «Funcionário» e usam o seu e-mail (gestor) +
          usuário + senha.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] py-2" style={{ color: 'var(--text-3)' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> A carregar…
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral" className="tabular-nums">
              {activeCount} / {max} ativos
            </Badge>
            {activeCount >= max && (
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                Limite cheio — revogue um para criar outro.
              </span>
            )}
          </div>

          <div
            className="rounded-xl p-4 space-y-3"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
              Novo acesso
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-[10px] font-medium block mb-1" style={{ color: 'var(--text-3)' }}>
                  Nome (só para você)
                </label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ex.: Maria"
                  disabled={busy || activeCount >= max}
                  className="text-[13px] w-full"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium block mb-1" style={{ color: 'var(--text-3)' }}>
                  Usuário
                </label>
                <Input
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="maria_silva"
                  disabled={busy || activeCount >= max}
                  className="text-[13px] font-mono w-full"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium block mb-1" style={{ color: 'var(--text-3)' }}>
                  Senha
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  disabled={busy || activeCount >= max}
                  className="text-[13px] w-full"
                />
              </div>
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy || activeCount >= max || !auth.currentUser}
              leftIcon={busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              onClick={() => void handleCreate()}
              className="w-full sm:w-auto"
            >
              Criar acesso
            </Button>
          </div>

          {rows.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                Lista
              </p>
              <ul className="space-y-1.5">
                {rows.map((r) => (
                  <li
                    key={`${r.staffAuthUid}-${r.loginSlug}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-[13px]"
                    style={{
                      background: 'var(--surface-1)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <div className="min-w-0">
                      <span className="font-semibold truncate inline-block max-w-[200px]" style={{ color: 'var(--text-1)' }}>
                        {r.displayName || r.loginSlug}
                      </span>
                      <span className="font-mono text-[12px] ml-2" style={{ color: 'var(--text-2)' }}>
                        @{r.loginSlug}
                      </span>
                      {r.revoked && (
                        <span className="text-[11px] ml-2 opacity-75" style={{ color: 'var(--text-3)' }}>
                          (revogado)
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!r.revoked && (
                        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void revoke(r.staffAuthUid)}>
                          Revogar
                        </Button>
                      )}
                      {r.revoked && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy || !r.staffAuthUid}
                          leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                          onClick={() => void permanentRemove(r.staffAuthUid)}
                          className="text-red-600 hover:text-red-700 dark:text-red-400"
                        >
                          Apagar da lista
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
};
