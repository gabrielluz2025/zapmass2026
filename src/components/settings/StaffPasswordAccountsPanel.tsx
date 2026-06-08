import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardCopy, KeyRound, Loader2, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Button, Input } from '../ui';
import { apiFetchJson } from '../../utils/apiFetchAuth';
import { auth } from '../../services/firebase';
import { getVpsAuthUser, useVpsAuth } from '../../services/vpsAuth';
import { STAFF_PASSWORD_ACCOUNTS_FALLBACK_MAX } from '../../constants/workspaceStaff';

type Props = {
  noTopMargin?: boolean;
  onMutation?: () => void;
  onActiveCount?: (count: number, max: number) => void;
};

function managerEmail(): string {
  if (useVpsAuth()) return getVpsAuthUser()?.email?.trim() || '';
  return (auth.currentUser?.email ?? '').trim();
}

function genericStaffInviteText(managerEmail: string): string {
  const site = typeof window !== 'undefined' ? window.location.origin : '[URL do ZapMass]';
  const mail = managerEmail || '[e-mail do responsável]';
  return [
    'Olá!',
    '',
    'Para entrar na conta ZapMass da equipa:',
    '',
    `1) Abra ${site}`,
    '2) No login, escolha «Funcionário» (usuário + senha).',
    `3) E-mail da conta do responsável: ${mail}`,
    '4) Usuário e senha: combinados com o gestor (canal seguro para a primeira senha).',
    ''
  ].join('\n');
}

export const StaffPasswordAccountsPanel: React.FC<Props> = ({ noTopMargin, onMutation, onActiveCount }) => {
  const [loading, setLoading] = useState(true);
  const [activeCount, setActiveCount] = useState(0);
  const [max, setMax] = useState(STAFF_PASSWORD_ACCOUNTS_FALLBACK_MAX);

  const [displayName, setDisplayName] = useState('');
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const mail = managerEmail();

  const loadMeta = useCallback(async () => {
    try {
      const j = await apiFetchJson<{
        items?: Array<{ revoked?: boolean }>;
        max?: number;
      }>('/api/workspace/staff-password-users');
      const items = Array.isArray(j.items) ? j.items : [];
      const active = items.filter((r) => !r.revoked).length;
      setActiveCount(active);
      if (typeof j.max === 'number') setMax(j.max);
      onActiveCount?.(active, typeof j.max === 'number' ? j.max : max);
    } catch {
      /* contagem opcional — tabela principal mostra erro */
    } finally {
      setLoading(false);
    }
  }, [max, onActiveCount]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

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
      await apiFetchJson('/api/workspace/staff-password-users', {
        method: 'POST',
        body: JSON.stringify({
          displayName: displayName.trim(),
          loginName: loginName.trim().toLowerCase(),
          password
        })
      });
      toast.success('Funcionário criado. Envie usuário e senha por canal seguro.');
      setLoginName('');
      setPassword('');
      setDisplayName('');
      await loadMeta();
      onMutation?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar.');
    } finally {
      setBusy(false);
    }
  };

  const copyGenericInstructions = async () => {
    if (!mail) {
      toast.error('Não foi possível ler o e-mail da conta. Atualize a sessão.');
      return;
    }
    try {
      await navigator.clipboard.writeText(genericStaffInviteText(mail));
      toast.success('Instruções copiadas.');
    } catch {
      toast.error('Não foi possível copiar.');
    }
  };

  const shell = noTopMargin ? '' : 'mt-6';
  const canSubmit = displayName.trim().length >= 2 && loginName.trim().length >= 3 && password.length >= 8;
  const atLimit = activeCount >= max;

  return (
    <div
      className={`rounded-2xl overflow-hidden ${shell}`}
      style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="px-5 sm:px-6 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>
              Novo login com senha
            </h3>
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-3)' }}>
              O funcionário entra em «Funcionário» com seu e-mail, usuário e senha.
            </p>
          </div>
          {!loading && (
            <Badge variant={atLimit ? 'warning' : 'neutral'} className="tabular-nums">
              {activeCount} / {max} vagas
            </Badge>
          )}
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-4">
        <div
          className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
        >
          <p className="text-[12px] flex-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>
            Modelo de mensagem para enviar ao funcionário
            {mail ? (
              <> (e-mail da conta: <strong>{mail}</strong>)</>
            ) : (
              ' — entre na sessão para preencher o e-mail.'
            )}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!mail || busy}
            leftIcon={<ClipboardCopy className="w-3.5 h-3.5" />}
            onClick={() => void copyGenericInstructions()}
            className="shrink-0"
          >
            Copiar instruções
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--text-3)' }}>
              Nome interno
            </label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Ex.: Maria"
              disabled={busy || atLimit}
              className="text-[13px] w-full"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--text-3)' }}>
              Usuário
            </label>
            <Input
              value={loginName}
              onChange={(e) => setLoginName(e.target.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="maria_silva"
              disabled={busy || atLimit}
              className="text-[13px] font-mono w-full"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--text-3)' }}>
              Senha inicial
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mín. 8 caracteres"
              disabled={busy || atLimit}
              className="text-[13px] w-full"
            />
          </div>
        </div>

        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={busy || atLimit || !canSubmit}
          leftIcon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
          onClick={() => void handleCreate()}
          className="w-full sm:w-auto"
        >
          {atLimit ? 'Limite de funcionários atingido' : 'Criar funcionário'}
        </Button>

        {atLimit && (
          <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            Revogue um acesso na tabela acima para liberar vaga.
          </p>
        )}
      </div>
    </div>
  );
};
