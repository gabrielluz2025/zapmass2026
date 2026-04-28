import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Users, Link2, Unlink, Copy, KeyRound } from 'lucide-react';
import { getAuth } from 'firebase/auth';
import { Badge, Button, Card, CardHeader, Input } from '../ui';
import { useWorkspace } from '../../context/WorkspaceContext';
import { auth } from '../../services/firebase';

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
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; code?: string; expiresAt?: string };
  if (!r.ok) throw new Error(j.error || `Erro HTTP ${r.status}`);
  return j;
};

export const WorkspaceTeamSection: React.FC = () => {
  const { loading, authUid, isTeamMember, ownerUid, effectiveWorkspaceUid } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [staffToRevoke, setStaffToRevoke] = useState('');

  const isOwnerPerspective = Boolean(authUid && !isTeamMember);

  const handleCreateInvite = async () => {
    setInviteBusy(true);
    try {
      const j = await apiFetch('/api/workspace/create-invite', { method: 'POST', body: JSON.stringify({}) });
      const code = typeof j.code === 'string' ? j.code : '';
      setGeneratedCode(code);
      if (code) {
        toast.success('Código criado — copie e envie com segurança ao membro.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar convite.');
    } finally {
      setInviteBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedCode) return;
    try {
      await navigator.clipboard.writeText(generatedCode);
      toast.success('Código copiado.');
    } catch {
      toast.error('Copie manualmente.');
    }
  };

  const handleRedeem = async () => {
    const c = codeInput.trim().replace(/\s+/g, '');
    if (c.length < 8) {
      toast.error('Cole o código completo do convite.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/workspace/redeem', {
        method: 'POST',
        body: JSON.stringify({ code: c })
      });
      toast.success('Conta ligada ao workspace principal. Os dados atualizam em segundos.');
      setCodeInput('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Código inválido ou já usado.');
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = async () => {
    if (!confirm('Voltar apenas à sua conta pessoal? Perde aqui o acesso ao workspace atual.')) return;
    setBusy(true);
    try {
      await apiFetch('/api/workspace/leave', { method: 'DELETE' });
      toast.success('Vínculo removido.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao sair.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeMember = async () => {
    const id = staffToRevoke.trim();
    if (id.length < 8) {
      toast.error('Cole o UID Firebase do funcionário.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/workspace/member/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast.success('Acesso revogado.');
      setStaffToRevoke('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao revogar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<Users className="w-4 h-4" />}
        title="Equipa — acesso de funcionários"
        subtitle="Conta partilhada mantém dados e assinatura do responsável pela organização."
      />
      <p className="text-[13px] leading-relaxed mb-4" style={{ color: 'var(--text-2)' }}>
        O <strong>dono da conta</strong> pode gerar um <strong>código de convite</strong>. Um colega com login Google faz
        login no ZapMass com a <strong>sua própria conta</strong>, cola o código aqui e passa a operar{' '}
        <strong>a mesma base</strong>, campanhas e chips (assinatura válida conta para o workspace).
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-3)' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> A carregar…
        </div>
      ) : (
        <>
          {authUid && (
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge variant="neutral">
                Login: {(auth.currentUser?.email || '').slice(0, 18)}
                {(auth.currentUser?.email || '').length > 18 ? '…' : ''}
              </Badge>
              <Badge variant="neutral">Dados workspace: {(effectiveWorkspaceUid || '').slice(0, 10)}…</Badge>
              {isTeamMember && ownerUid ? (
                <Badge variant="info">Membro de equipa (dono UID: {(ownerUid || '').slice(0, 8)}…)</Badge>
              ) : (
                <Badge variant="success">Admin principal do workspace</Badge>
              )}
            </div>
          )}

          {isTeamMember ? (
            <div className="space-y-3">
              <p className="text-[12px]" style={{ color: 'var(--text-3)' }}>
                Esta sessão trabalha sobre a conta do responsável pela assinatura. Para pagamentos e dados pessoais, saia deste
                vínculo.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
                disabled={busy}
                onClick={handleLeave}
              >
                Sair do workspace
              </Button>
            </div>
          ) : (
            <>
              <p className="text-[13px] font-semibold mt-6 mb-1" style={{ color: 'var(--text-1)' }}>
                Criar convite (dono)
              </p>
              <p className="text-[11.5px] mb-3" style={{ color: 'var(--text-3)' }}>
                Gera código seguro (válido cerca de 7 dias).
              </p>
              <div className="flex flex-wrap gap-2 items-center mb-4">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  leftIcon={<KeyRound className="w-3.5 h-3.5" />}
                  disabled={inviteBusy || !auth.currentUser || !isOwnerPerspective}
                  onClick={handleCreateInvite}
                >
                  {inviteBusy ? 'A gerar…' : 'Gerar código novo'}
                </Button>
                {generatedCode && (
                  <>
                    <code className="text-[12px] px-2 py-1 rounded" style={{ background: 'var(--surface-2)' }}>
                      {generatedCode.slice(0, 12)}…
                    </code>
                    <Button type="button" variant="secondary" size="sm" leftIcon={<Copy className="w-3 h-3" />} onClick={handleCopy}>
                      Copiar inteiro
                    </Button>
                  </>
                )}
              </div>

              <p className="text-[13px] font-semibold mt-6 mb-1" style={{ color: 'var(--text-1)' }}>
                Aceitar convite (funcionário)
              </p>
              <p className="text-[11.5px] mb-3" style={{ color: 'var(--text-3)' }}>
                Cole o código que o gestor enviou.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 max-w-xl">
                <Input
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  placeholder="Código de convite"
                  className="flex-1 font-mono text-[13px]"
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  leftIcon={<Link2 className="w-4 h-4" />}
                  disabled={busy || !auth.currentUser}
                  onClick={handleRedeem}
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Aceitar vínculo'}
                </Button>
              </div>

              <p className="text-[13px] font-semibold mt-6 mb-1" style={{ color: 'var(--text-1)' }}>
                Revogar acesso de um membro
              </p>
              <p className="text-[11.5px] mb-3" style={{ color: 'var(--text-3)' }}>
                Só o dono. Precisa do UID Firebase (Consola Firebase → Utilizadores).
              </p>
              <div className="flex flex-col sm:flex-row gap-2 max-w-xl mb-4">
                <Input
                  value={staffToRevoke}
                  onChange={(e) => setStaffToRevoke(e.target.value)}
                  placeholder="UID do funcionário no Firebase"
                  className="flex-1 font-mono text-[12px]"
                />
                <Button type="button" variant="secondary" size="sm" disabled={busy || !auth.currentUser} onClick={handleRevokeMember}>
                  Revogar
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
};
