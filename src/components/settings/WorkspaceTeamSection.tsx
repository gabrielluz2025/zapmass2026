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
  Sparkles,
  KeyRound
} from 'lucide-react';
import { Badge, Button, Card, CardHeader, Input } from '../ui';
import { StaffPasswordAccountsPanel } from './StaffPasswordAccountsPanel';
import { WorkspaceTeamMembersPanel } from './WorkspaceTeamMembersPanel';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useAuth } from '../../context/AuthContext';
import { apiFetchJson } from '../../utils/apiFetchAuth';
import { getVpsAuthUser } from '../../services/vpsAuth';

type Props = {
  variant?: 'embedded' | 'standalone';
};

type OwnerTab = 'password' | 'invite';
type Audience = 'owner' | 'invitee';

export const WorkspaceTeamSection: React.FC<Props> = ({ variant = 'embedded' }) => {
  const { user } = useAuth();
  const { loading, authUid, isTeamMember, effectiveWorkspaceUid } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [ownerTab, setOwnerTab] = useState<OwnerTab>('password');
  const [audience, setAudience] = useState<Audience>('owner');
  const [teamReload, setTeamReload] = useState(0);
  const [staffMax, setStaffMax] = useState<number | undefined>(undefined);

  const bumpTeamOverview = () => setTeamReload((n) => n + 1);

  const isOwnerPerspective = Boolean(authUid && !isTeamMember);
  const sessionEmail = getVpsAuthUser()?.email || user?.email || '';

  const handleCreateInvite = async () => {
    setInviteBusy(true);
    try {
      const j = await apiFetchJson<{ code?: string }>('/api/workspace/create-invite', {
        method: 'POST',
        body: JSON.stringify({})
      });
      const code = typeof j.code === 'string' ? j.code : '';
      setGeneratedCode(code);
      if (code) toast.success('Código criado.');
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
      await apiFetchJson('/api/workspace/redeem', {
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
      await apiFetchJson('/api/workspace/leave', { method: 'DELETE' });
      toast.success('Você saiu do workspace da equipa.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao sair.');
    } finally {
      setBusy(false);
    }
  };

  const cardClass = variant === 'standalone' ? 'p-0 border-0 shadow-none bg-transparent' : '';

  const tabBtn = (id: OwnerTab, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={ownerTab === id}
      onClick={() => setOwnerTab(id)}
      className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 py-3 px-3 rounded-xl text-[13px] font-bold transition-all"
      style={
        ownerTab === id
          ? { background: 'var(--brand-600)', color: '#fff', boxShadow: '0 4px 14px rgba(0,0,0,0.12)' }
          : { background: 'var(--surface-1)', color: 'var(--text-3)', border: '1px solid var(--border-subtle)' }
      }
    >
      {icon}
      {label}
    </button>
  );

  return (
    <Card className={cardClass}>
      {variant === 'embedded' && (
        <CardHeader
          icon={<Users className="w-4 h-4" />}
          title="Funcionários"
          subtitle="Controle quem acessa sua conta ZapMass."
        />
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] p-6" style={{ color: 'var(--text-3)' }}>
          <Loader2 className="w-4 h-4 animate-spin" /> A carregar…
        </div>
      ) : (
        <div className="space-y-5">
          {isTeamMember ? (
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
              {isOwnerPerspective && (
                <div
                  className="grid grid-cols-2 gap-2 p-1 rounded-xl"
                  style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                  role="tablist"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={audience === 'owner'}
                    onClick={() => setAudience('owner')}
                    className="py-2.5 px-3 rounded-lg text-[13px] font-bold transition"
                    style={
                      audience === 'owner'
                        ? { background: 'var(--surface-0)', color: 'var(--text-1)', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }
                        : { color: 'var(--text-3)' }
                    }
                  >
                    Sou o responsável
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={audience === 'invitee'}
                    onClick={() => setAudience('invitee')}
                    className="py-2.5 px-3 rounded-lg text-[13px] font-bold transition"
                    style={
                      audience === 'invitee'
                        ? { background: 'var(--surface-0)', color: 'var(--text-1)', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }
                        : { color: 'var(--text-3)' }
                    }
                  >
                    Recebi um código
                  </button>
                </div>
              )}

              {audience === 'invitee' && isOwnerPerspective && (
                <div
                  className="rounded-2xl p-5 sm:p-6 border space-y-4"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}
                >
                  <p className="text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>
                    Ativar convite
                  </p>
                  <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
                    Use o <strong>seu Google</strong> e cole o código enviado pelo gestor.
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
                      disabled={busy || !user}
                      onClick={handleRedeem}
                      className="sm:min-w-[140px]"
                    >
                      Ativar
                    </Button>
                  </div>
                </div>
              )}

              {audience === 'owner' && isOwnerPerspective && (
                <div className="space-y-5">
                  <WorkspaceTeamMembersPanel
                    enabled
                    reloadToken={teamReload}
                    maxStaff={staffMax}
                    onRevoked={bumpTeamOverview}
                  />

                  <div className="flex flex-wrap gap-2" role="tablist" aria-label="Forma de adicionar">
                    {tabBtn('password', 'Usuário e senha', <KeyRound className="w-4 h-4" />)}
                    {tabBtn('invite', 'Convite Google', <Sparkles className="w-4 h-4" />)}
                  </div>

                  {ownerTab === 'password' && (
                    <StaffPasswordAccountsPanel
                      noTopMargin
                      onMutation={bumpTeamOverview}
                      onActiveCount={(_c, m) => setStaffMax(m)}
                    />
                  )}

                  {ownerTab === 'invite' && (
                    <div
                      className="rounded-2xl p-5 sm:p-6 border space-y-4"
                      style={{ borderColor: 'var(--border)', background: 'var(--surface-0)' }}
                    >
                      <div>
                        <h2 className="text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>
                          Convite para quem usa Google
                        </h2>
                        <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--text-3)' }}>
                          Gere um código e envie. A pessoa ativa em «Recebi um código» com a conta Google dela.
                        </p>
                      </div>

                      <Button
                        type="button"
                        variant="primary"
                        size="lg"
                        leftIcon={<Send className="w-4 h-4" />}
                        disabled={inviteBusy || !user}
                        onClick={handleCreateInvite}
                      >
                        {inviteBusy ? 'A gerar…' : 'Gerar código de convite'}
                      </Button>

                      {generatedCode && (
                        <div
                          className="rounded-xl p-4 space-y-3"
                          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
                        >
                          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                            Código (envie completo)
                          </p>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <code
                              className="flex-1 break-all rounded-lg px-3 py-2.5 text-[12px] font-mono"
                              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
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
                </div>
              )}
            </>
          )}

          {authUid && variant === 'embedded' && (
            <div className="pt-4 border-t flex flex-wrap gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <Badge variant="neutral">
                {sessionEmail.length > 28 ? `${sessionEmail.slice(0, 28)}…` : sessionEmail}
              </Badge>
              {!isTeamMember && effectiveWorkspaceUid && (
                <Badge variant="neutral" className="font-mono text-[11px]">
                  workspace
                </Badge>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};
