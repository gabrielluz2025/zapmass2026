import React, { useState } from 'react';
import { Loader2, Lock, Mail, ShieldCheck, Sparkles, Users, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { formatTrialHoursLabel } from '../../utils/trialCopy';
import { trackLandingEvent } from '../../utils/marketingEvents';
import { clearTrialSessionFlags, setTrialSessionForManager } from '../../utils/trialSession';

/** Título e subtítulo padrão (landing + rota de login isolada). */
export const loginCardDefaultCopy = {
  title: 'Comece em um passo',
  subtitle:
    'Responsável: e-mail e senha (conta nova ou existente). Equipe: usuário e senha criados pelo gestor em Funcionários.'
} as const;

interface LoginCardProps {
  title?: string;
  subtitle?: string;
  /** Quando true, o CTA principal ja inicia o teste apos login (fluxo unificado). */
  showTrialOption?: boolean;
  /** Na landing: textos curtos + bloco «Entrada segura» recolhível (menos ruído). */
  landingLayout?: boolean;
}

type OauthPid = 'google' | 'facebook';
type LoadingState =
  | 'idle'
  | 'staff'
  | 'oauth:google:trial'
  | 'oauth:google:customer'
  | 'oauth:facebook:trial'
  | 'oauth:facebook:customer'
  | 'email-signin'
  | 'email-signup';

const oauthSpin = (loading: LoadingState, provider: OauthPid) => loading.startsWith(`oauth:${provider}:`);

const fieldInputClass =
  'mt-1.5 w-full rounded-xl px-3.5 py-3 text-[13px] outline-none transition-[box-shadow,border-color] focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-500/40 disabled:opacity-60';

const fieldInputClassCompact =
  'mt-0.5 w-full rounded-lg px-3 py-2 text-[12.5px] outline-none transition-[box-shadow,border-color] focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-500/40 disabled:opacity-60';

export const LoginCard: React.FC<LoginCardProps> = ({
  title = loginCardDefaultCopy.title,
  subtitle = loginCardDefaultCopy.subtitle,
  showTrialOption = false,
  landingLayout = false
}) => {
  const {
    signInWithEmailPassword,
    signUpWithEmailPassword,
    signInWithStaffCredentials
  } = useAuth();
  const { config } = useAppConfig();
  const [entryMode, setEntryMode] = useState<'admin' | 'staff'>('admin');
  const [loading, setLoading] = useState<LoadingState>('idle');

  const [managerEmail, setManagerEmail] = useState('');
  const [staffLoginName, setStaffLoginName] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [emailAuth, setEmailAuth] = useState('');
  const [passwordAuth, setPasswordAuth] = useState('');
  const [passwordConfirmAuth, setPasswordConfirmAuth] = useState('');

  const runManagerEmailAuth = async () => {
    const em = emailAuth.trim().toLowerCase();
    const pw = passwordAuth;
    if (!em.includes('@')) {
      toast.error('Informe um e-mail válido.');
      return;
    }
    if (pw.length < 6) {
      toast.error('Senha com pelo menos 6 caracteres.');
      return;
    }

    setTrialSessionForManager(showTrialOption ? 'trial' : 'customer');
    setLoading('email-signin');
    try {
      await signInWithEmailPassword(em, pw);
      setPasswordAuth('');
      setPasswordConfirmAuth('');
      return;
    } catch {
      /* tenta cadastro */
    } finally {
      setLoading('idle');
    }
    if (passwordConfirmAuth !== pw) {
      toast.error('As senhas não coincidem.');
      return;
    }
    if (landingLayout) {
      trackLandingEvent('landing_login_click', { login_kind: 'email_signup' });
    }
    setTrialSessionForManager(showTrialOption ? 'trial' : 'customer');
    setLoading('email-signup');
    try {
      await signUpWithEmailPassword(em, pw);
      setPasswordAuth('');
      setPasswordConfirmAuth('');
    } finally {
      setLoading('idle');
    }
  };

  const runStaffLogin = async () => {
    const me = managerEmail.trim().toLowerCase();
    const slug = staffLoginName.trim();
    if (!me.includes('@')) {
      toast.error('Informe o e-mail principal (do responsável pelo ZapMass).');
      return;
    }
    if (slug.length < 3) {
      toast.error('Nome de usuário deve ter pelo menos 3 caracteres (letras minúsculas, números ou _).');
      return;
    }
    if (staffPassword.length < 8) {
      toast.error('Senha com pelo menos 8 caracteres.');
      return;
    }
    if (landingLayout) {
      trackLandingEvent('landing_login_click', { login_kind: 'staff' });
    }
    try {
      clearTrialSessionFlags();
    } catch {
      /* ignore */
    }
    setLoading('staff');
    try {
      await signInWithStaffCredentials(me, slug, staffPassword);
      setStaffPassword('');
    } catch {
      toast.error('Erro de rede. Tente de novo.');
    } finally {
      setLoading('idle');
    }
  };

  const busy = loading !== 'idle';

  return (
    <div
      className={`landing-card-glow relative w-full overflow-hidden ring-1 ring-white/[0.06] ${landingLayout ? 'rounded-2xl' : 'rounded-[1.65rem]'}`}
      style={{
        background: 'var(--surface-0)',
        border: '1px solid var(--border)',
        boxShadow: landingLayout ? '0 12px 32px rgba(0,0,0,0.16)' : 'var(--shadow-lg, 0 22px 55px rgba(0,0,0,0.22))'
      }}
    >
      <div
        className={`${landingLayout ? 'h-[2px]' : 'h-1'} w-full bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500 opacity-[0.92]`}
        aria-hidden
      />
      <div className={`relative z-[1] ${landingLayout ? 'p-3 sm:p-3.5' : 'p-6 sm:p-8'}`}>
        {!landingLayout && (
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border mb-3"
            style={{
              background: 'rgba(16,185,129,0.08)',
              borderColor: 'rgba(16,185,129,0.25)'
            }}
          >
            <Sparkles className="w-3 h-3" style={{ color: 'var(--brand-600)' }} />
            <span className="text-[10.5px] uppercase tracking-widest font-bold" style={{ color: 'var(--brand-600)' }}>
              Bem-vindo
            </span>
          </div>
        )}

        <h2
          className={`font-extrabold leading-tight tracking-tight ${landingLayout ? 'mb-1 text-[1.05rem] sm:text-[1.1rem]' : 'mb-2 text-[1.35rem] sm:text-[1.45rem]'}`}
          style={{ color: 'var(--text-1)' }}
        >
          {title}
        </h2>
        <p className={`${landingLayout ? 'mb-3 text-[11.5px] sm:text-[12px]' : 'mb-7 text-[13px]'} max-w-[42ch] leading-snug sm:max-w-none`} style={{ color: 'var(--text-3)' }}>
          {subtitle}
        </p>

        {/* Quem entra: gestor (OAuth) ou funcionário (usuário + senha criados pelo gestor) */}
        <div
          className={`flex gap-1 rounded-xl p-1 ${landingLayout ? 'mb-3' : 'mb-5 sm:mb-6 gap-1.5 rounded-2xl p-1.5'}`}
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' }}
          role="tablist"
          aria-label="Tipo de acesso"
        >
          <button
            type="button"
            role="tab"
            aria-selected={entryMode === 'admin'}
            onClick={() => setEntryMode('admin')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg font-bold transition-all duration-200 ${
              landingLayout ? 'py-1.5 text-[11px]' : 'py-2.5 px-2 text-[11.5px] sm:py-3 sm:px-3 sm:text-[12.5px]'
            } ${entryMode === 'admin' ? 'shadow-[0_2px_10px_rgba(0,0,0,0.05)]' : 'opacity-75 hover:opacity-100'}`}
            style={{
              background: entryMode === 'admin' ? 'var(--surface-0)' : 'transparent',
              color: 'var(--text-1)',
              border: entryMode === 'admin' ? '1px solid var(--border-subtle)' : '1px solid transparent'
            }}
          >
            <Zap className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
            Responsável
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={entryMode === 'staff'}
            onClick={() => setEntryMode('staff')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg font-bold transition-all duration-200 ${
              landingLayout ? 'py-1.5 text-[11px]' : 'py-2.5 px-2 text-[11.5px] sm:py-3 sm:px-3 sm:text-[12.5px]'
            } ${entryMode === 'staff' ? 'shadow-[0_2px_10px_rgba(0,0,0,0.05)]' : 'opacity-75 hover:opacity-100'}`}
            style={{
              background: entryMode === 'staff' ? 'var(--surface-0)' : 'transparent',
              color: 'var(--text-1)',
              border: entryMode === 'staff' ? '1px solid var(--border-subtle)' : '1px solid transparent'
            }}
          >
            <Users className="h-3.5 w-3.5 shrink-0 text-sky-500" />
            Funcionário
          </button>
        </div>

        {entryMode === 'staff' ? (
          <div
            className="mb-2 space-y-4 rounded-2xl p-4 sm:p-5 sm:space-y-5"
            style={{
              background:
                'linear-gradient(165deg, rgba(14,165,233,0.07) 0%, var(--surface-1) 42%, var(--surface-0) 100%)',
              border: '1px solid rgba(14,165,233,0.18)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)'
            }}
          >
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
              O responsável cria o seu usuário e senha na área <strong>Funcionários</strong> do painel. Use o{' '}
              <strong>e-mail principal do gestor</strong> (o mesmo da conta dele no ZapMass) e o usuário que criou para você.
            </p>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                E-mail do responsável (gestor)
              </label>
              <input
                type="email"
                autoComplete="username"
                value={managerEmail}
                onChange={(e) => setManagerEmail(e.target.value)}
                disabled={busy}
                placeholder="nome@empresa.com"
                className={fieldInputClass}
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-1)'
                }}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                Seu nome de usuário
              </label>
              <input
                type="text"
                autoComplete="nickname"
                value={staffLoginName}
                onChange={(e) => setStaffLoginName(e.target.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                disabled={busy}
                placeholder="ex.: maria_silva"
                className={`${fieldInputClass} font-mono`}
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-1)'
                }}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                Senha
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={staffPassword}
                onChange={(e) => setStaffPassword(e.target.value)}
                disabled={busy}
                placeholder="••••••••"
                className={fieldInputClass}
                style={{
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-1)'
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => void runStaffLogin()}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-[14px] font-bold text-white transition-all hover:brightness-110 disabled:opacity-60"
              style={{
                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                boxShadow: '0 12px 28px rgba(2,132,199,0.3)'
              }}
            >
              {loading === 'staff' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Entrando…
                </>
              ) : (
                <>
                  <Users className="h-4 w-4" />
                  Entrar como funcionário
                </>
              )}
            </button>
            <p className="pt-0.5 text-[11px] leading-snug" style={{ color: 'var(--text-3)' }}>
              Este acesso usa a assinatura da conta do gestor. O teste grátis só é ativado quando o responsável entra pela
              primeira vez (Google, Facebook ou e-mail e senha).
            </p>
          </div>
        ) : (
          <>
            <div
              className={`${landingLayout ? 'space-y-2.5 rounded-lg p-2.5' : 'space-y-3 rounded-xl p-3 sm:p-3.5'}`}
              style={{
                background: landingLayout
                  ? 'var(--surface-1)'
                  : 'linear-gradient(180deg, rgba(16,185,129,0.028) 0%, var(--surface-1) 52%)',
                border: '1px solid var(--border-subtle)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)'
              }}
            >
              <div
                className={`rounded-md leading-snug ${landingLayout ? 'px-2.5 py-1.5 text-[10.5px]' : 'rounded-lg px-3 py-2 text-[11px] sm:text-[11.5px]'}`}
                style={{
                  background: 'rgba(16,185,129,0.04)',
                  border: '1px solid rgba(16,185,129,0.08)',
                  color: 'var(--text-2)'
                }}
              >
                {showTrialOption
                  ? `Detectamos se o e-mail já existe. Conta nova exige confirmação. Teste grátis ${formatTrialHoursLabel(config.trialHours)}.`
                  : 'Detectamos se o e-mail já existe. Conta nova exige a confirmação da senha.'}
              </div>

              <div className={landingLayout ? 'space-y-2' : 'space-y-2.5'}>
                <div>
                  <label className={`font-medium ${landingLayout ? 'text-[10.5px]' : 'text-[11px]'}`} style={{ color: 'var(--text-3)' }}>
                    E-mail
                  </label>
                  <input
                    type="email"
                    autoComplete="email"
                    value={emailAuth}
                    onChange={(e) => setEmailAuth(e.target.value)}
                    disabled={busy}
                    placeholder="voce@email.com"
                    className={fieldInputClassCompact}
                    style={{
                      background: 'var(--surface-0)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-1)'
                    }}
                  />
                </div>
                <div>
                  <label className={`font-medium ${landingLayout ? 'text-[10.5px]' : 'text-[11px]'}`} style={{ color: 'var(--text-3)' }}>
                    Senha
                  </label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={passwordAuth}
                    onChange={(e) => setPasswordAuth(e.target.value)}
                    disabled={busy}
                    placeholder="••••••••"
                    className={fieldInputClassCompact}
                    style={{
                      background: 'var(--surface-0)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-1)'
                    }}
                  />
                </div>
                <div>
                  <label className={`font-medium ${landingLayout ? 'text-[10.5px]' : 'text-[11px]'}`} style={{ color: 'var(--text-3)' }}>
                    Confirmar senha <span style={{ opacity: 0.7 }}>(só conta nova)</span>
                  </label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={passwordConfirmAuth}
                    onChange={(e) => setPasswordConfirmAuth(e.target.value)}
                    disabled={busy}
                    placeholder="••••••••"
                    className={fieldInputClassCompact}
                    style={{
                      background: 'var(--surface-0)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-1)'
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void runManagerEmailAuth()}
                  disabled={busy}
                  className={`flex w-full items-center justify-center gap-2 rounded-lg font-semibold text-white transition-all hover:brightness-[1.04] disabled:opacity-60 ${
                    landingLayout ? 'px-3 py-2 text-[12.5px]' : 'px-4 py-2.5 text-[13px]'
                  }`}
                  style={{
                    background: 'linear-gradient(135deg, #0f766e 0%, #0d9488 55%, #14b8a6 100%)',
                    boxShadow: landingLayout ? '0 3px 10px rgba(15,118,110,0.18)' : '0 4px 14px rgba(15,118,110,0.2)'
                  }}
                >
                  {loading === 'email-signup' || loading === 'email-signin' ? (
                    <>
                      <Loader2 className={landingLayout ? 'h-3.5 w-3.5 animate-spin' : 'h-4 w-4 animate-spin'} />
                      {loading === 'email-signup' ? 'Criando…' : 'Entrando…'}
                    </>
                  ) : (
                    <>
                      <Mail className={landingLayout ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
                      Continuar com e-mail
                    </>
                  )}
                </button>
              </div>

              {landingLayout && showTrialOption && (
                <p className="text-center text-[9.5px] font-medium leading-snug -mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {formatTrialHoursLabel(config.trialHours)} liberado · sem cartão
                </p>
              )}

            </div>
          </>
        )}

        {landingLayout ? (
          <details
            className="group mt-3 overflow-hidden rounded-lg border"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
          >
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-2 text-[10.5px] font-semibold select-none transition-colors hover:bg-black/[0.04]">
              <Lock className="w-3 h-3 shrink-0" style={{ color: 'var(--brand-600)' }} />
              <span style={{ color: 'var(--text-2)' }}>Como funciona o acesso e a segurança</span>
              <span className="ml-auto text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                Ver
              </span>
            </summary>
            <div className="px-2.5 pb-2.5 pt-0 space-y-1.5 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              {entryMode === 'admin' ? (
                <>
                  <Feature
                    icon={<ShieldCheck className="w-3.5 h-3.5" />}
                    label="Responsável: e-mail e senha na VPS. Funcionários: aba Funcionário."
                  />
                  <Feature icon={<Zap className="w-3.5 h-3.5" />} label="Sessão persistente no navegador" />
                </>
              ) : (
                <>
                  <Feature
                    icon={<Lock className="w-3.5 h-3.5" />}
                    label="Senha de funcionário validada no servidor e ligada à conta do gestor."
                  />
                  <Feature icon={<Users className="w-3.5 h-3.5" />} label="Até 10 funcionários — o gestor cria e revoga no painel." />
                </>
              )}
              <Feature icon={<Sparkles className="w-3.5 h-3.5" />} label="Sem fidelidade no teste: você decide quando assinar" />
            </div>
          </details>
        ) : (
          <>
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
              <span
                className="inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-widest"
                style={{ color: 'var(--text-3)' }}
              >
                <Lock className="w-3 h-3" />
                Entrada segura
              </span>
              <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
            </div>

            <div className="space-y-2">
              {entryMode === 'admin' ? (
                <>
                  <Feature
                    icon={<ShieldCheck className="w-3.5 h-3.5" />}
                    label="Responsável: e-mail e senha — conta nova ou existente no servidor ZapMass."
                  />
                  <Feature icon={<Zap className="w-3.5 h-3.5" />} label="Sessão persistente: entra uma vez e fica logado" />
                </>
              ) : (
                <>
                  <Feature
                    icon={<Lock className="w-3.5 h-3.5" />}
                    label="Senha de funcionário validada no servidor e ligada à conta do gestor."
                  />
                  <Feature icon={<Users className="w-3.5 h-3.5" />} label="Limite de 10 funcionários com senha — o gestor gere e revoga no painel." />
                </>
              )}
              <Feature icon={<Sparkles className="w-3.5 h-3.5" />} label="Sem fidelidade na experiência: você decide quando continuar" />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const Feature: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
  <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg" style={{ background: 'var(--surface-1)' }}>
    <div
      className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
      style={{
        background: 'linear-gradient(135deg, rgba(16,185,129,0.22), rgba(16,185,129,0.08))',
        color: 'var(--brand-600)'
      }}
    >
      {icon}
    </div>
    <span className="text-[12.5px] font-medium" style={{ color: 'var(--text-2)' }}>
      {label}
    </span>
  </div>
);
