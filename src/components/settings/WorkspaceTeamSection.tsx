import React, { useState } from 'react';
import toast from 'react-hot-toast';
import {
  Loader2,
  Users,
  Link2,
  Unlink,
  Copy,
  Send,
  CheckCircle2,
  ChevronDown,
  UserPlus,
  Smartphone
} from 'lucide-react';
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

type Props = {
  /** `standalone` — página própria; `embedded` — dentro de Configurações. */
  variant?: 'embedded' | 'standalone';
};

export const WorkspaceTeamSection: React.FC<Props> = ({ variant = 'embedded' }) => {
  const { loading, authUid, isTeamMember, ownerUid, effectiveWorkspaceUid } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [staffToRevoke, setStaffToRevoke] = useState('');
  const [showJoinHelp, setShowJoinHelp] = useState(variant === 'standalone');

  const isOwnerPerspective = Boolean(authUid && !isTeamMember);

  const handleCreateInvite = async () => {
    setInviteBusy(true);
    try {
      const j = await apiFetch('/api/workspace/create-invite', { method: 'POST', body: JSON.stringify({}) });
      const code = typeof j.code === 'string' ? j.code : '';
      setGeneratedCode(code);
      if (code) {
        toast.success('Convite criado! Envie o código à pessoa.');
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
      toast.success('Código copiado — pode colar no WhatsApp.');
    } catch {
      toast.error('Selecione e copie o código manualmente.');
    }
  };

  const handleRedeem = async () => {
    const c = codeInput.trim().replace(/\s+/g, '');
    if (c.length < 8) {
      toast.error('Cole o código completo que o gestor enviou.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/workspace/redeem', {
        method: 'POST',
        body: JSON.stringify({ code: c })
      });
      toast.success('Pronto! Daqui a instantes verá a conta da equipa.');
      setCodeInput('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Código inválido ou já usado.');
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = async () => {
    if (!confirm('Sair desta conta partilhada e voltar só à sua conta pessoal?')) return;
    setBusy(true);
    try {
      await apiFetch('/api/workspace/leave', { method: 'DELETE' });
      toast.success('Você saiu do workspace da equipa.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao sair.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeMember = async () => {
    const id = staffToRevoke.trim();
    if (id.length < 8) {
      toast.error('Cole o identificador técnico (UID) do utilizador.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/workspace/member/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast.success('Acesso removido.');
      setStaffToRevoke('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível remover.');
    } finally {
      setBusy(false);
    }
  };

  const cardClass = variant === 'standalone' ? 'p-0 border-0 shadow-none bg-transparent' : '';

  return (
    <Card className={cardClass}>
      {variant === 'embedded' && (
        <CardHeader
          icon={<Users className="w-4 h-4" />}
          title="Funcionários"
          subtitle="Convide quem ajuda a operar — mesmos contatos e chips que a sua conta principal."
        />
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] p-6" style={{ color: 'var(--text-3)' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> A carregar…
        </div>
      ) : (
        <>
          {/* Membro já ligado */}
          {isTeamMember && ownerUid ? (
            <div
              className="rounded-2xl p-5 border space-y-3"
              style={{ background: 'var(--surface-0)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#10b981' }} />
                <div>
                  <p className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>
                    Você está na equipa da conta principal
                  </p>
                  <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>
                    Os disparos e contatos são os do responsável pela assinatura. Pagamentos e plano ficam sempre na conta do
                    gestor.
                  </p>
                </div>
              </div>
              <Badge variant="info">Workspace ativo · dados partilhados</Badge>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
                disabled={busy}
                onClick={handleLeave}
              >
                Sair deste acesso partilhado
              </Button>
            </div>
          ) : (
            <>
              {/* Bloco DONO — passo a passo visível */}
              <div
                className="rounded-2xl p-5 sm:p-6 border"
                style={{
                  background: 'linear-gradient(180deg, rgba(16,185,129,0.08), transparent)',
                  borderColor: 'rgba(16,185,129,0.35)'
                }}
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                    style={{
                      background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))',
                      color: '#fff',
                      boxShadow: '0 10px 28px -8px rgba(16,185,129,0.5)'
                    }}
                  >
                    <UserPlus className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-[17px] sm:text-[19px] font-extrabold leading-tight" style={{ color: 'var(--text-1)' }}>
                      Adicionar funcionário ou parceiro
                    </h2>
                    <p className="text-[12.5px] mt-1" style={{ color: 'var(--text-2)' }}>
                      A mesma conta ZapMass para mais de uma pessoa — cada uma com login Google próprio.
                    </p>
                  </div>
                </div>

                <ol className="space-y-3 mb-6">
                  {[
                    { n: '1', t: 'Gere um convite com o botão verde.', d: 'Cria um código seguro válido vários dias.' },
                    {
                      n: '2',
                      t: 'Envie o código à pessoa.',
                      d: 'Por WhatsApp, e-mail ou o que preferir.'
                    },
                    {
                      n: '3',
                      t: 'Ela entra no ZapMass e cola o código.',
                      d: 'Menu "Funcionários" (esta página) ou Configurações → Equipa.'
                    }
                  ].map((step) => (
                    <li key={step.n} className="flex gap-3">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold"
                        style={{
                          background: 'rgba(16,185,129,0.2)',
                          color: 'var(--brand-700)'
                        }}
                      >
                        {step.n}
                      </span>
                      <div>
                        <p className="text-[13.5px] font-bold" style={{ color: 'var(--text-1)' }}>
                          {step.t}
                        </p>
                        <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                          {step.d}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>

                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  className="w-full sm:w-auto min-h-[48px] text-[14px]"
                  leftIcon={<Send className="w-5 h-5" />}
                  disabled={inviteBusy || !auth.currentUser || !isOwnerPerspective}
                  onClick={handleCreateInvite}
                >
                  {inviteBusy ? 'A gerar convite…' : 'Gerar convite para enviar'}
                </Button>

                {generatedCode && (
                  <div
                    className="mt-5 rounded-xl p-4 border"
                    style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}
                  >
                    <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
                      Código do convite (copie inteiro)
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                      <code
                        className="flex-1 break-all rounded-lg px-3 py-2.5 text-[13px] font-mono font-semibold"
                        style={{
                          background: 'var(--bg)',
                          border: '1px solid var(--border)',
                          color: 'var(--text-1)'
                        }}
                      >
                        {generatedCode}
                      </code>
                      <Button
                        type="button"
                        variant="secondary"
                        size="lg"
                        leftIcon={<Copy className="w-4 h-4" />}
                        onClick={handleCopy}
                        className="shrink-0"
                      >
                        Copiar tudo
                      </Button>
                    </div>
                    <p className="text-[11.5px] mt-2 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                      <Smartphone className="w-3.5 h-3.5" /> Dica: mande por WhatsApp para a pessoa colar aqui no ZapMass.
                    </p>
                  </div>
                )}
              </div>

              {/* Funcionário que recebeu código — destaque secundário */}
              <div className="mt-6 rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left text-[13px] font-bold transition-colors hover:bg-white/5"
                  style={{ color: 'var(--text-1)', background: 'var(--surface-1)' }}
                  onClick={() => setShowJoinHelp((v) => !v)}
                >
                  <span className="flex items-center gap-2">
                    <Link2 className="w-4 h-4" style={{ color: 'var(--brand-600)' }} />
                    Recebeu um código? Ative o acesso aqui
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 shrink-0 transition-transform ${showJoinHelp ? 'rotate-180' : ''}`}
                    style={{ color: 'var(--text-3)' }}
                  />
                </button>
                {showJoinHelp && (
                  <div className="p-4 pt-2 space-y-3" style={{ background: 'var(--surface-0)' }}>
                    <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                      Faça login com <strong>o seu Google</strong> (conta própria). Cole abaixo o código que o gestor enviou e
                      confirme.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        value={codeInput}
                        onChange={(e) => setCodeInput(e.target.value)}
                        placeholder="Cole o código aqui"
                        className="flex-1 font-mono text-[13px]"
                      />
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        leftIcon={<Link2 className="w-4 h-4" />}
                        disabled={busy || !auth.currentUser}
                        onClick={handleRedeem}
                        className="sm:min-w-[140px]"
                      >
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ativar acesso'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Avançado — revogar */}
              <details className="mt-6 group">
                <summary
                  className="cursor-pointer text-[12px] font-semibold list-none flex items-center gap-2 py-2"
                  style={{ color: 'var(--text-3)' }}
                >
                  <ChevronDown className="w-4 h-4 group-open:rotate-180 transition-transform" />
                  Opções avançadas (remover acesso de alguém)
                </summary>
                <div className="pl-1 pt-2 pb-2 space-y-2">
                  <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                    Só use se precisar bloquear o acesso de um colaborador. É necessário o{' '}
                    <strong>identificador UID</strong> do utilizador na consola Firebase (Authentication → utilizador → copiar UID).
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 max-w-xl">
                    <Input
                      value={staffToRevoke}
                      onChange={(e) => setStaffToRevoke(e.target.value)}
                      placeholder="UID do utilizador a remover"
                      className="flex-1 font-mono text-[12px]"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy || !auth.currentUser}
                      onClick={handleRevokeMember}
                    >
                      Remover acesso
                    </Button>
                  </div>
                </div>
              </details>
            </>
          )}

          {authUid && variant === 'embedded' && (
            <div className="mt-4 pt-4 border-t flex flex-wrap gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <Badge variant="neutral">
                Sessão: {(auth.currentUser?.email || '').slice(0, 22)}
                {(auth.currentUser?.email || '').length > 22 ? '…' : ''}
              </Badge>
              {!isTeamMember && (
                <Badge variant="neutral">Dados da conta: {(effectiveWorkspaceUid || '').slice(0, 12)}…</Badge>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
};
