import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldOff, UserPlus } from 'lucide-react';
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

/**
 * Gestão de funcionários que entram por nome de usuário + senha (API servidor + Firebase Auth).
 */
export const StaffPasswordAccountsPanel: React.FC = () => {
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
      toast.success('Acesso criado. Informe ao funcionário: e-mail do Google que você usa no ZapMass, usuário e senha.');
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
    if (!confirm('Revogar este acesso? Essa pessoa não poderá mais entrar por usuário/senha.')) return;
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

  return (
    <div
      className="rounded-2xl p-5 sm:p-6 border mt-8 space-y-4"
      style={{
        borderColor: 'rgba(59,130,246,0.3)',
        background: 'linear-gradient(180deg, rgba(59,130,246,0.06), transparent)'
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg, #0369a1, #075985)', color: '#fff' }}
        >
          <KeyRound className="w-5 h-5" />
        </div>
        <div>
          <p className="text-[13px] font-extrabold" style={{ color: 'var(--text-1)' }}>
            Acesso por usuário e senha
          </p>
          <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Até <strong>{max}</strong> funcionários com login próprio (nome de usuário + senha). Na tela inicial, eles escolhem
            «Funcionário» e usam o <strong>seu e-mail de responsável (Google)</strong> + usuário + senha.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-3)' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> A carregar…
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">
              {activeCount} / {max} ativos
            </Badge>
            {activeCount >= max && (
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                Limite atingido — revogue um acesso para criar outro.
              </span>
            )}
          </div>

          <div
            className="rounded-xl p-4 space-y-3 border"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}
          >
            <p className="text-[12px] font-bold" style={{ color: 'var(--text-2)' }}>
              <UserPlus className="w-3.5 h-3.5 inline mr-1" />
              Novo funcionário
            </p>
            <div className="grid sm:grid-cols-3 gap-2">
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Nome para identificar (ex.: Maria)"
                disabled={busy || activeCount >= max}
                className="text-[13px]"
              />
              <Input
                value={loginName}
                onChange={(e) => setLoginName(e.target.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="Usuário (só a-z, 0-9, _)"
                disabled={busy || activeCount >= max}
                className="text-[13px] font-mono"
              />
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Senha (mín. 8)"
                disabled={busy || activeCount >= max}
                className="text-[13px]"
              />
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy || activeCount >= max || !auth.currentUser}
              leftIcon={busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              onClick={() => void handleCreate()}
            >
              Cadastrar acesso
            </Button>
          </div>

          {rows.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                Cadastrados
              </p>
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li
                    key={`${r.staffAuthUid}-${r.loginSlug}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 border text-[12px]"
                    style={{
                      borderColor: 'var(--border-subtle)',
                      background: r.revoked ? 'var(--surface-1)' : 'var(--surface-0)',
                      opacity: r.revoked ? 0.75 : 1
                    }}
                  >
                    <div>
                      <span className="font-bold" style={{ color: 'var(--text-1)' }}>
                        {r.displayName || r.loginSlug}
                      </span>
                      <span className="font-mono ml-2" style={{ color: 'var(--text-2)' }}>
                        @{r.loginSlug}
                      </span>
                      {r.revoked && (
                        <Badge variant="neutral" className="ml-2">
                          Revogado
                        </Badge>
                      )}
                    </div>
                    {!r.revoked && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        leftIcon={<ShieldOff className="w-3.5 h-3.5" />}
                        onClick={() => void revoke(r.staffAuthUid)}
                      >
                        Revogar
                      </Button>
                    )}
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
