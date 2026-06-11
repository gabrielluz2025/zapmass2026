import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ClipboardCopy,
  KeyRound,
  Loader2,
  RefreshCw,
  Shield,
  UserMinus,
  Users
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Input } from '../ui';
import { Modal } from '../ui/Modal';
import { apiFetchJson } from '../../utils/apiFetchAuth';
import { getVpsAuthUser } from '../../services/vpsAuth';
import { useAuth } from '../../context/AuthContext';

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
  reloadToken: number;
  maxStaff?: number;
  onRevoked?: () => void;
};

function formatLinked(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(d);
}

function managerEmailFromSession(): string {
  return getVpsAuthUser()?.email?.trim() || '';
}

function inviteText(slug?: string): string {
  const site = typeof window !== 'undefined' ? window.location.origin : '[URL do ZapMass]';
  const mail = managerEmailFromSession() || '[e-mail do responsável]';
  const base = [
    'Olá!',
    '',
    'Para entrar na conta ZapMass da equipa:',
    '',
    `1) Abra ${site}`,
    '2) No login, escolha «Funcionário» (usuário + senha).',
    `3) E-mail da conta do responsável: ${mail}`,
    '4) Usuário e senha: combinados com o gestor (use canal seguro para a primeira senha).',
    ''
  ].join('\n');
  return slug ? `${base}Seu usuário (sem @ no login): ${slug}` : base;
}

function isServerConfigError(msg: string): boolean {
  return (
    msg.includes('Firebase Admin') ||
    msg.includes('configurado no servidor') ||
    msg.includes('Postgres indispon')
  );
}

export const WorkspaceTeamMembersPanel: React.FC<Props> = ({
  enabled,
  reloadToken,
  maxStaff,
  onRevoked
}) => {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<WorkspaceMemberRow[]>([]);
  const [configError, setConfigError] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [resetRow, setResetRow] = useState<WorkspaceMemberRow | null>(null);
  const [resetPass, setResetPass] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetSaving, setResetSaving] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const j = await apiFetchJson<{
        items?: Array<{
          staffAuthUid?: string;
          loginSlug?: string;
          displayName?: string;
          createdAt?: string | null;
          revoked?: boolean;
        }>;
      }>('/api/workspace/staff-password-users');
      const items = Array.isArray(j.items) ? j.items : [];
      setConfigError(false);
      setRows(
        items
          .filter((r) => !r.revoked)
          .map((r) => ({
            uid: String(r.staffAuthUid || ''),
            source: 'password' as const,
            loginSlug: r.loginSlug ?? null,
            email: null,
            displayName: r.displayName ?? null,
            linkedAt: r.createdAt ?? null
          }))
          .filter((r) => Boolean(r.uid))
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (isServerConfigError(msg)) {
        setConfigError(true);
        setRows([]);
      } else {
        toast.error(msg || 'Não foi possível carregar membros da equipa.');
        setRows([]);
      }
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const revoke = async (row: WorkspaceMemberRow) => {
    const label = row.displayName || row.loginSlug || row.email || 'este membro';
    const verb = row.source === 'password' ? 'revogar o login por senha' : 'remover o vínculo do convite';
    if (!confirm(`Tem certeza? Isto vai ${verb} de ${label}.`)) return;
    setBusyUid(row.uid);
    try {
      if (row.source === 'password') {
        await apiFetchJson(`/api/workspace/staff-password-users/${encodeURIComponent(row.uid)}`, {
          method: 'DELETE'
        });
      } else {
        await apiFetchJson(`/api/workspace/member/${encodeURIComponent(row.uid)}`, {
          method: 'DELETE'
        });
      }
      toast.success(row.source === 'password' ? 'Acesso revogado.' : 'Membro removido.');
      await load();
      onRevoked?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao remover.');
    } finally {
      setBusyUid(null);
    }
  };

  const copyInvite = async (row: WorkspaceMemberRow) => {
    if (row.source !== 'password' || !row.loginSlug) {
      toast.error('Instruções por senha só para logins com usuário.');
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteText(row.loginSlug));
      toast.success('Instruções copiadas.');
    } catch {
      toast.error('Não foi possível copiar.');
    }
  };

  const submitPasswordReset = async () => {
    if (!resetRow?.uid) return;
    if (resetPass.length < 8) {
      toast.error('Nova senha: mínimo 8 caracteres.');
      return;
    }
    if (resetPass !== resetConfirm) {
      toast.error('As senhas não coincidem.');
      return;
    }
    setResetSaving(true);
    try {
      await apiFetchJson(`/api/workspace/staff-password-users/${encodeURIComponent(resetRow.uid)}`, {
        method: 'PATCH',
        body: JSON.stringify({ password: resetPass })
      });
      toast.success('Senha atualizada.');
      setResetRow(null);
      setResetPass('');
      setResetConfirm('');
      onRevoked?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível alterar a senha.');
    } finally {
      setResetSaving(false);
    }
  };

  if (!enabled) return null;

  if (configError) {
    return (
      <div
        className="rounded-2xl px-5 py-4 flex items-start gap-3"
        style={{
          background: 'var(--semantic-warning-bg, rgba(245,158,11,0.08))',
          border: '1px solid rgba(245,158,11,0.25)'
        }}
      >
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
          Lista de membros indisponível — o servidor não possui credenciais configuradas.{' '}
          Configure <code className="font-mono text-[11px] px-1 rounded" style={{ background: 'var(--surface-2)' }}>FIREBASE_SERVICE_ACCOUNT_PATH</code>{' '}
          ou a conexão com o banco de dados.
        </p>
      </div>
    );
  }

  const activeCount = rows.length;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
    >
      <div
        className="h-1 w-full"
        style={{ background: 'linear-gradient(90deg, var(--brand-500), #3b82f6)' }}
      />
      <div className="p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--brand-600)' }}
            >
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-[16px] font-black tracking-tight" style={{ color: 'var(--text-1)' }}>
                Sua equipa
              </h2>
              <p className="text-[12px] mt-1 leading-relaxed max-w-lg" style={{ color: 'var(--text-3)' }}>
                Gerencie acessos, troque senhas e revogue quem não deve mais entrar na conta.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="info" className="tabular-nums">
              {activeCount}
              {maxStaff != null ? ` / ${maxStaff}` : ''} ativos
            </Badge>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="p-2 rounded-lg transition"
              style={{ background: 'var(--surface-1)', color: 'var(--text-3)' }}
              title="Atualizar lista"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-8 justify-center text-[13px]" style={{ color: 'var(--text-3)' }}>
            <Loader2 className="w-4 h-4 animate-spin" /> A carregar membros…
          </div>
        ) : rows.length === 0 ? (
          <div
            className="rounded-xl py-10 px-4 text-center"
            style={{ background: 'var(--surface-1)', border: '1px dashed var(--border-subtle)' }}
          >
            <Shield className="w-10 h-10 mx-auto mb-3 opacity-25" style={{ color: 'var(--text-3)' }} />
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-2)' }}>
              Nenhum funcionário ligado ainda
            </p>
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>
              Use as opções abaixo para criar um login com senha ou gerar convite.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border-subtle)' }}>
            <table className="w-full text-left text-[13px] min-w-[520px]">
              <thead>
                <tr style={{ background: 'var(--surface-1)', color: 'var(--text-3)' }}>
                  <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider">Membro</th>
                  <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider">Acesso</th>
                  <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider hidden sm:table-cell">Desde</th>
                  <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const main = row.displayName || row.email || row.loginSlug || row.uid.slice(0, 8);
                  return (
                    <tr
                      key={row.uid}
                      className="border-t"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <td className="px-3 py-3">
                        <p className="font-semibold truncate max-w-[180px]" style={{ color: 'var(--text-1)' }}>
                          {main}
                        </p>
                        {row.email && row.loginSlug && (
                          <p className="text-[11px] truncate max-w-[200px]" style={{ color: 'var(--text-3)' }}>
                            {row.email}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={row.source === 'password' ? 'info' : 'success'} className="text-[10px]">
                            {row.source === 'password' ? 'Senha' : 'Convite'}
                          </Badge>
                          {row.loginSlug && (
                            <span className="font-mono text-[11px]" style={{ color: 'var(--text-2)' }}>
                              @{row.loginSlug}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 hidden sm:table-cell tabular-nums text-[12px]" style={{ color: 'var(--text-3)' }}>
                        {formatLinked(row.linkedAt)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap justify-end gap-1">
                          {row.source === 'password' && (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={busyUid !== null}
                                leftIcon={<KeyRound className="w-3.5 h-3.5" />}
                                onClick={() => setResetRow(row)}
                              >
                                Senha
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={busyUid !== null}
                                leftIcon={<ClipboardCopy className="w-3.5 h-3.5" />}
                                onClick={() => void copyInvite(row)}
                              >
                                Copiar
                              </Button>
                            </>
                          )}
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
                            className="text-red-600 hover:text-red-700 dark:text-red-400"
                            onClick={() => void revoke(row)}
                          >
                            Revogar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        isOpen={Boolean(resetRow)}
        onClose={() => {
          if (resetSaving) return;
          setResetRow(null);
          setResetPass('');
          setResetConfirm('');
        }}
        title="Nova senha do funcionário"
        subtitle={
          resetRow ? (
            <span>
              {resetRow.displayName || resetRow.loginSlug}{' '}
              {resetRow.loginSlug && (
                <span className="font-mono text-[12px]" style={{ color: 'var(--text-3)' }}>
                  @{resetRow.loginSlug}
                </span>
              )}
            </span>
          ) : null
        }
        footer={
          <div className="flex flex-wrap gap-2 justify-end w-full">
            <Button type="button" variant="secondary" size="sm" disabled={resetSaving} onClick={() => setResetRow(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={resetSaving || resetPass.length < 8 || resetPass !== resetConfirm}
              leftIcon={resetSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              onClick={() => void submitPasswordReset()}
            >
              Guardar senha
            </Button>
          </div>
        }
      >
        <div className="grid gap-3">
          <div>
            <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--text-3)' }}>
              Nova senha
            </label>
            <Input
              type="password"
              value={resetPass}
              onChange={(e) => setResetPass(e.target.value)}
              autoComplete="new-password"
              placeholder="Mínimo 8 caracteres"
              className="w-full text-[13px]"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--text-3)' }}>
              Confirmar senha
            </label>
            <Input
              type="password"
              value={resetConfirm}
              onChange={(e) => setResetConfirm(e.target.value)}
              autoComplete="new-password"
              className="w-full text-[13px]"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};
