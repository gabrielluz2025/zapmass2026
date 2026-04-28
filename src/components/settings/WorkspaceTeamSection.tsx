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
  Sparkles
} from 'lucide-react';
import { getAuth } from 'firebase/auth';
import { Badge, Button, Card, CardHeader, Input } from '../ui';
import { StaffPasswordAccountsPanel } from './StaffPasswordAccountsPanel';
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
  variant?: 'embedded' | 'standalone';
};

type OwnerTab = 'invite' | 'password';
type Audience = 'owner' | 'invitee';

export const WorkspaceTeamSection: React.FC<Props> = ({ variant = 'embedded' }) => {
  const { loading, authUid, isTeamMember, ownerUid, effectiveWorkspaceUid } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [staffToRevoke, setStaffToRevoke] = useState('');
  const [ownerTab, setOwnerTab] = useState<OwnerTab>('invite');
  const [audience, setAudience] = useState<Audience>('owner');

  const isOwnerPerspective = Boolean(authUid && !isTeamMember);

  const handleCreateInvite = async () => {
    setInviteBusy(true);
    try {
      const j = await apiFetch('/api/workspace/create-invite', { method: 'POST', body: JSON.stringify({}) });
      const code = typeof j.code === 'string' ? j.code : '';
      setGeneratedCode(code);
      if (code) {
        toast.success('Código criado.');
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
      toast.success('Copiado.');
    } catch {
      toast.error('Copie manualmente.');
    }
  };

  const handleRedeem = async () => {
    const c = codeInput.trim().replace(/\s+/g, '');
    if (c.length < 8) {
      toast.error('Código incompleto.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/workspace/redeem', {
        method: 'POST',
        body: JSON.stringify({ code: c })
      });
      toast.success('Conta ligada. A página atualiza em instantes.');
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
      toast.error('Cole o UID do utilizador (Firebase).');
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

  const tabBtn = (id: OwnerTab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={ownerTab === id}
      onClick={() => setOwnerTab(id)}
      className="flex-1 min-w-[140px] py-2.5 px-3 rounded-lg text-[13px] font-semibold transition-all"
      style={{
        background: ownerTab === id ? 'var(--surface-0)' : 'transparent',
        color: ownerTab === id ? 'var(--text-1)' : 'var(--text-3)',
        boxShadow: ownerTab === id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
        border: ownerTab === id ? '1px solid var(--border-subtle)' : '1px solid transparent'
      }}
    >
      {label}
    </button>
  );

  return (
    <Card className={cardClass}>
      {variant === 'embedded' && (
        <CardHeader
          icon={<Users className="w-4 h-4" />}
          title="Funcionários"
          subtitle="Mesmos contatos e chips da conta principal — escolha como adicionar alguém."
        />
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] p-6" style={{ color: 'var(--text-3)' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> A carregar…
        </div>
      ) : (
        <>
          {isTeamMember && ownerUid ? (
            <div
              className="rounded-2xl p-5 border space-y-3"
              style={{ background: 'var(--surface-0)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#10b981' }} />
                <div>
                  <p className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>
                    Você está na equipa
                  </p>
                  <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>
                    Contatos e disparos são os do responsável pelo plano.
                  </p>
                </div>
              </div>
              <Badge variant="info">Acesso partilhado ativo</Badge>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
                disabled={busy}
                onClick={handleLeave}
              >
                Sair desta equipa
              </Button>
            </div>
          ) : (
            <>
              {/* Quem é você nesta página — evita misturar gestor com quem só recebeu código */}
              {isOwnerPerspective && (
                <div
                  className="flex flex-wrap gap-1 p-1 rounded-xl mb-5"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                  role="tablist"
                  aria-label="Quem está a usar esta página"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={audience === 'owner'}
                    onClick={() => setAudience('owner')}
                    className="flex-1 min-w-[160px] py-2.5 px-3 rounded-lg text-[13px] font-semibold transition-all"
                    style={{
                      background: audience === 'owner' ? 'var(--surface-0)' : 'transparent',
                      color: audience === 'owner' ? 'var(--text-1)' : 'var(--text-3)',
                      boxShadow: audience === 'owner' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                      border: audience === 'owner' ? '1px solid var(--border-subtle)' : '1px solid transparent'
                    }}
                  >
                    Sou o responsável
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={audience === 'invitee'}
                    onClick={() => setAudience('invitee')}
                    className="flex-1 min-w-[160px] py-2.5 px-3 rounded-lg text-[13px] font-semibold transition-all"
                    style={{
                      background: audience === 'invitee' ? 'var(--surface-0)' : 'transparent',
                      color: audience === 'invitee' ? 'var(--text-1)' : 'var(--text-3)',
                      boxShadow: audience === 'invitee' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                      border: audience === 'invitee' ? '1px solid var(--border-subtle)' : '1px solid transparent'
                    }}
                  >
                    Recebi um código
                  </button>
                </div>
              )}

              {audience === 'invitee' && isOwnerPerspective && (
                <div
                  className="rounded-2xl p-5 sm:p-6 border space-y-4 mb-2"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}
                >
                  <p className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>
                    Ativar o convite
                  </p>
                  <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                    Use o <strong>seu Google</strong> (conta própria). Cole o código que o gestor enviou.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value)}
                      placeholder="Colar código completo"
                      className="flex-1 font-mono text-[13px]"
                    />
                    <Button
                      type="button"
                      variant="primary"
                      size="lg"
                      leftIcon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                      disabled={busy || !auth.currentUser}
                      onClick={handleRedeem}
                      className="sm:min-w-[140px]"
                    >
                      Ativar acesso
                    </Button>
                  </div>
                  <button
                    type="button"
                    className="text-[12px] font-medium underline-offset-2 hover:underline"
                    style={{ color: 'var(--brand-600)' }}
                    onClick={() => setAudience('owner')}
                  >
                    Sou o responsável — gerir convites e senhas
                  </button>
                </div>
              )}

              {audience === 'owner' && isOwnerPerspective && (
                <>
                  <div
                    className="flex flex-wrap gap-1 p-1 rounded-xl mb-5"
                    style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                    role="tablist"
                    aria-label="Forma de adicionar"
                  >
                    {tabBtn('invite', 'Convite com código')}
                    {tabBtn('password', 'Usuário e senha')}
                  </div>

                  {ownerTab === 'invite' && (
                    <div
                      className="rounded-2xl p-5 sm:p-6 border space-y-4"
                      style={{
                        borderColor: 'var(--border)',
                        background: 'var(--surface-0)'
                      }}
                    >
                      <div className="flex gap-3">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                          style={{
                            background: 'linear-gradient(135deg, rgba(16,185,129,0.25), rgba(16,185,129,0.08))',
                            color: 'var(--brand-600)'
                          }}
                        >
                          <Sparkles className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <h2 className="text-[16px] font-bold leading-snug" style={{ color: 'var(--text-1)' }}>
                            Convite para quem já usa Google
                          </h2>
                          <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>
                            Gere um código e envie. A pessoa abre esta página, escolhe <strong>Recebi um código</strong> no topo e
                            cola o código com o <strong>Google dela</strong>.
                          </p>
                        </div>
                      </div>

                      <Button
                        type="button"
                        variant="primary"
                        size="lg"
                        className="w-full sm:w-auto"
                        leftIcon={<Send className="w-4 h-4" />}
                        disabled={inviteBusy || !auth.currentUser}
                        onClick={handleCreateInvite}
                      >
                        {inviteBusy ? 'A gerar…' : 'Gerar código de convite'}
                      </Button>

                      {generatedCode && (
                        <div
                          className="rounded-xl p-4 space-y-3"
                          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                        >
                          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                            Código (envie completo)
                          </p>
                          <div className="flex flex-col sm:flex-row gap-2 sm:items-stretch">
                            <code
                              className="flex-1 break-all rounded-lg px-3 py-2.5 text-[12px] font-mono font-medium"
                              style={{
                                background: 'var(--bg)',
                                border: '1px solid var(--border)',
                                color: 'var(--text-1)'
                              }}
                            >
                              {generatedCode}
                            </code>
                            <Button type="button" variant="secondary" size="sm" leftIcon={<Copy className="w-4 h-4" />} onClick={handleCopy}>
                              Copiar
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {ownerTab === 'password' && <StaffPasswordAccountsPanel noTopMargin />}
                </>
              )}

              {audience === 'owner' && isOwnerPerspective && (
                <details className="mt-5 group rounded-lg px-2 py-1">
                  <summary
                    className="cursor-pointer text-[12px] font-medium list-none flex items-center gap-2 py-2"
                    style={{ color: 'var(--text-3)' }}
                  >
                    <ChevronDown className="w-3.5 h-3.5 group-open:rotate-180 transition-transform shrink-0" />
                    Ferramenta técnica — remover acesso por UID (Firebase)
                  </summary>
                  <div className="pb-3 pl-6 space-y-2">
                    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                      Para convites criados antes de haver lista automática — precisa do UID na consola Firebase.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2 max-w-xl">
                      <Input
                        value={staffToRevoke}
                        onChange={(e) => setStaffToRevoke(e.target.value)}
                        placeholder="UID"
                        className="flex-1 font-mono text-[12px]"
                      />
                      <Button type="button" variant="secondary" size="sm" disabled={busy || !auth.currentUser} onClick={handleRevokeMember}>
                        Remover
                      </Button>
                    </div>
                  </div>
                </details>
              )}
            </>
          )}

          {authUid && variant === 'embedded' && (
            <div className="mt-6 pt-4 border-t flex flex-wrap gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <Badge variant="neutral">
                {(auth.currentUser?.email || '').slice(0, 24)}
                {(auth.currentUser?.email || '').length > 24 ? '…' : ''}
              </Badge>
              {!isTeamMember && (
                <Badge variant="neutral" className="font-mono text-[11px]">
                  {(effectiveWorkspaceUid || '').slice(0, 10)}…
                </Badge>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
};
