import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardCopy, KeyRound, Loader2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Input } from '../ui';
import { Modal } from '../ui/Modal';
import { getAuth } from 'firebase/auth';
import { auth } from '../../services/firebase';
import { STAFF_PASSWORD_ACCOUNTS_FALLBACK_MAX } from '../../constants/workspaceStaff';

const apiFetch = async (path: string, init?: RequestInit): Promise<Record<string, unknown>> => {
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
  return j as Record<string, unknown>;
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
  /** Chamado depois de criar, revogar, remover ou redefinir senha — para atualizar o resumo da equipa. */
  onMutation?: () => void;
};

function originForInstructions(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
}

function genericStaffInviteText(managerEmail: string): string {
  const site = originForInstructions() || '[URL do ZapMass]';
  const mail = managerEmail || '[e-mail ZapMass do responsável]';
  return [
    'Olá!',
    '',
    'Para entrar na conta ZapMass da equipa:',
    '',
    `1) Abra ${site}`,
    '2) No login, escolha a opção de Funcionário (usuário + senha).',
    `3) E-mail da conta ZapMass do responsável: ${mail}`,
    '4) Usuário e senha: combinados diretamente com o gestor (use um canal seguro para a primeira senha).',
    ''
  ].join('\n');
}

function tailoredStaffInviteText(managerEmail: string, loginSlug: string): string {
  return `${genericStaffInviteText(managerEmail)}\nSeu usuário (sem @ na hora do login): ${loginSlug}`;
}

function formatCreated(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(d);
}

/**
 * Gestão de funcionários que entram por nome de usuário + senha.
 */
export const StaffPasswordAccountsPanel: React.FC<Props> = ({ noTopMargin, onMutation }) => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [max, setMax] = useState(STAFF_PASSWORD_ACCOUNTS_FALLBACK_MAX);

  const [displayName, setDisplayName] = useState('');
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const [resetRow, setResetRow] = useState<StaffRow | null>(null);
  const [resetPass, setResetPass] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetSaving, setResetSaving] = useState(false);

  const managerEmail = (auth.currentUser?.email ?? '').trim();

  const load = useCallback(async () => {
    try {
      const j = (await apiFetch('/api/workspace/staff-password-users')) as unknown as {
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

  const bump = () => onMutation?.();

  const handleCreate = async () => {
    if (displayName.trim().length < 2) {
      toast.error('Informe pelo menos 2 caracteres no nome.');
      return;
    }
    if (loginName.trim().length < 3) {
      toast.error('O usuário precisa ter pelo menos 3 caracteres.');
      return;
    }
    if (password.length < 8) {
      toast.error('A senha deve ter pelo menos 8 caracteres.');
      return;
    }
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
      toast.success(
        'Acesso criado. Combine com a pessoa: e‑mail ZapMass do responsável, usuário e senha inicial (canal seguro).'
      );
      setLoginName('');
      setPassword('');
      setDisplayName('');
      await load();
      bump();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar.');
    } finally {
      setBusy(false);
    }
  };

  const copyGenericInstructions = async () => {
    if (!managerEmail) {
      toast.error('Não foi possível ler o seu e‑mail ZapMass. Atualize a sessão.');
      return;
    }
    try {
      await navigator.clipboard.writeText(genericStaffInviteText(managerEmail));
      toast.success('Texto copiado. Envie pelo WhatsApp ou e‑mail ao funcionário.');
    } catch {
      toast.error('Não conseguimos copiar — copie manualmente.');
    }
  };

  const copyForUser = async (slug: string) => {
    if (!managerEmail) {
      toast.error('Não foi possível ler o seu e‑mail ZapMass.');
      return;
    }
    try {
      await navigator.clipboard.writeText(tailoredStaffInviteText(managerEmail, slug));
      toast.success('Instruções com este usuário copiadas.');
    } catch {
      toast.error('Não conseguimos copiar.');
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
      bump();
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
      bump();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao apagar.');
    } finally {
      setBusy(false);
    }
  };

  const submitPasswordReset = async () => {
    if (!resetRow?.staffAuthUid) return;
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
      await apiFetch(`/api/workspace/staff-password-users/${encodeURIComponent(resetRow.staffAuthUid)}`, {
        method: 'PATCH',
        body: JSON.stringify({ password: resetPass })
      });
      toast.success('Senha atualizada.');
      setResetRow(null);
      setResetPass('');
      setResetConfirm('');
      bump();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível alterar a senha.');
    } finally {
      setResetSaving(false);
    }
  };

  const closeResetModal = () => {
    if (resetSaving) return;
    setResetRow(null);
    setResetPass('');
    setResetConfirm('');
  };

  const shell = noTopMargin ? '' : 'mt-8';

  const canSubmitNew = displayName.trim().length >= 2 && loginName.trim().length >= 3 && password.length >= 8;

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
          Até <strong>{max}</strong> logins próprios. Na entrada no site, peça ao funcionário que escolha «Funcionário» e informe o seu e‑mail
          ZapMass (o do gestor, como referência — não é o e‑mail Google dela, embora o gestor possa usar Gmail) mais o usuário e a senha combinados.
        </p>
      </div>

      <Modal
        isOpen={Boolean(resetRow)}
        onClose={closeResetModal}
        title="Nova senha do funcionário"
        subtitle={
          resetRow ? (
            <span className="text-[13px]">
              {resetRow.displayName || resetRow.loginSlug}{' '}
              <span className="font-mono text-[12px]" style={{ color: 'var(--text-3)' }}>
                @{resetRow.loginSlug}
              </span>
            </span>
          ) : null
        }
        footer={
          <div className="flex flex-wrap gap-2 justify-end w-full">
            <Button type="button" variant="secondary" size="sm" disabled={resetSaving} onClick={closeResetModal}>
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
              Guardar nova senha
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
              className="text-[13px] w-full"
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
              className="text-[13px] w-full"
            />
          </div>
        </div>
      </Modal>

      {!loading && (
        <div
          className="rounded-xl p-4 space-y-3"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
            O que enviar ao funcionário
          </p>
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Use este texto modelo (adapta ao que já combinou sobre usuário/senha). O e‑mail usado será o seu e‑mail da conta ZapMass{' '}
            {managerEmail ? (
              <span className="font-medium" style={{ color: 'var(--text-1)' }}>
                ({managerEmail})
              </span>
            ) : (
              '(entre na sessão para preencher).'
            )}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!managerEmail || busy}
            leftIcon={<ClipboardCopy className="w-3.5 h-3.5" />}
            onClick={() => void copyGenericInstructions()}
            className="w-full sm:w-auto"
          >
            Copiar instruções (genéricas)
          </Button>
          {rows.some((r) => !r.revoked) ? (
            <p className="text-[11px] leading-snug" style={{ color: 'var(--text-3)' }}>
              Para cada usuário também pode usar <strong>«Copiar com este usuário»</strong> na lista incluindo o nome de login certo.
            </p>
          ) : (
            <p className="text-[11px] leading-snug" style={{ color: 'var(--text-3)' }}>
              Após criar o primeiro acesso, poderá enviar texto já com o usuário criado por linha.
            </p>
          )}
        </div>
      )}

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

          {rows.length === 0 && activeCount === 0 && activeCount < max && (
            <ol
              className="text-[12px] list-decimal pl-5 space-y-1.5 leading-relaxed rounded-xl p-3"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', color: 'var(--text-2)' }}
            >
              <li>Preencha nome interno + usuário + senha forte abaixo e crie o acesso.</li>
              <li>Combine a senha inicial por WhatsApp Signal ou outro canal seguro.</li>
              <li>Envie o texto com «Copiar instruções», ou o texto por linha com o usuário certo.</li>
            </ol>
          )}

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
                  Senha inicial
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
              disabled={busy || activeCount >= max || !auth.currentUser || !canSubmitNew}
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
                    className="flex flex-wrap items-start justify-between gap-2 rounded-lg px-3 py-2.5 text-[13px]"
                    style={{
                      background: 'var(--surface-1)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span
                          className="font-semibold truncate inline-block max-w-[180px]"
                          style={{ color: 'var(--text-1)' }}
                        >
                          {r.displayName || r.loginSlug}
                        </span>
                        <Badge variant={r.revoked ? 'neutral' : 'success'} className="text-[10px]">
                          {r.revoked ? 'Revogado' : 'Ativo'}
                        </Badge>
                      </div>
                      <p className="font-mono text-[12px]" style={{ color: 'var(--text-2)' }}>
                        @{r.loginSlug}
                      </p>
                      <p className="text-[11px] mt-0.5 tabular-nums" style={{ color: 'var(--text-3)' }}>
                        Criado em {formatCreated(r.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 shrink-0 w-full sm:w-auto">
                      {!r.revoked && (
                        <>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            leftIcon={<ClipboardCopy className="w-3.5 h-3.5" />}
                            className="w-full sm:w-auto"
                            onClick={() => void copyForUser(r.loginSlug)}
                          >
                            Copiar com este usuário
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            leftIcon={<KeyRound className="w-3.5 h-3.5" />}
                            onClick={() => setResetRow(r)}
                          >
                            Nova senha
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => void revoke(r.staffAuthUid)}
                          >
                            Revogar
                          </Button>
                        </>
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
