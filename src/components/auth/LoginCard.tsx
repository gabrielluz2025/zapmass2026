import React, { useState } from 'react';
import { Loader2, Lock, LogIn, Mail, ShieldCheck, Sparkles, UserPlus, Users, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { formatTrialHoursLabel } from '../../utils/trialCopy';
import { trackLandingEvent } from '../../utils/marketingEvents';

/** Título e subtítulo padrão (landing + rota de login isolada). */
export const loginCardDefaultCopy = {
  title: 'Comece em um passo',
  subtitle:
    'Responsável: rede social ou e-mail. Equipe: login criado pelo gestor em Funcionários — o formulário mostra o passo a passo.'
} as const;

interface LoginCardProps {
  title?: string;
  subtitle?: string;
  /** Quando true, o CTA principal ja inicia o teste apos login (fluxo unificado). */
  showTrialOption?: boolean;
  /** Na landing: textos curtos + bloco «Entrada segura» recolhível (menos ruído). */
  landingLayout?: boolean;
}

type OauthPid = 'google' | 'facebook' | 'apple';
type LoadingState =
  | 'idle'
  | 'staff'
  | 'oauth:google:trial'
  | 'oauth:google:customer'
  | 'oauth:facebook:trial'
  | 'oauth:facebook:customer'
  | 'oauth:apple:trial'
  | 'oauth:apple:customer'
  | 'email-signin'
  | 'email-signup';

const oauthSpin = (loading: LoadingState, provider: OauthPid, mode: 'trial' | 'customer') =>
  loading === (`oauth:${provider}:${mode}` as LoadingState);

const fieldInputClass =
  'mt-1.5 w-full rounded-xl px-3.5 py-3 text-[13px] outline-none transition-[box-shadow,border-color] focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-500/40 disabled:opacity-60';

function setTrialSessionForManager(mode: 'trial' | 'customer'): void {
  try {
    if (mode === 'trial') {
      sessionStorage.setItem('zapmass.startTrialAfterLogin', '1');
      sessionStorage.removeItem('zapmass.tryTrialIfNeededAfterLogin');
    } else {
      sessionStorage.removeItem('zapmass.startTrialAfterLogin');
      sessionStorage.setItem('zapmass.tryTrialIfNeededAfterLogin', '1');
    }
  } catch {
    /* ignore */
  }
}

export const LoginCard: React.FC<LoginCardProps> = ({
  title = loginCardDefaultCopy.title,
  subtitle = loginCardDefaultCopy.subtitle,
  showTrialOption = false,
  landingLayout = false
}) => {
  const {
    signInWithGoogle,
    signInWithFacebook,
    signInWithApple,
    signInWithEmailPassword,
    signUpWithEmailPassword,
    signInWithStaffCustomToken
  } = useAuth();
  const { config } = useAppConfig();
  const [entryMode, setEntryMode] = useState<'admin' | 'staff'>('admin');
  const [loading, setLoading] = useState<LoadingState>('idle');
  /** Responsável + fluxo com teste: distingue cadastro vs retorno (OAuth e e-mail). */
  const [managerJourney, setManagerJourney] = useState<'new' | 'returning'>('new');

  const [managerEmail, setManagerEmail] = useState('');
  const [staffLoginName, setStaffLoginName] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [emailAuth, setEmailAuth] = useState('');
  const [passwordAuth, setPasswordAuth] = useState('');
  const [passwordConfirmAuth, setPasswordConfirmAuth] = useState('');

  const runOAuthLogin = async (provider: 'google' | 'facebook' | 'apple', mode: 'trial' | 'customer') => {
    if (landingLayout) {
      trackLandingEvent('landing_login_click', {
        login_kind: mode === 'trial' ? `${provider}_trial` : `${provider}_existing`
      });
    }
    setTrialSessionForManager(mode === 'trial' ? 'trial' : 'customer');
    setLoading(`oauth:${provider}:${mode}` as LoadingState);
    try {
      if (provider === 'google') await signInWithGoogle();
      else if (provider === 'facebook') await signInWithFacebook();
      else await signInWithApple();
    } finally {
      setLoading('idle');
    }
  };

  const oauthModeForManager: 'trial' | 'customer' = managerJourney === 'new' ? 'trial' : 'customer';

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
    const isSignup = managerJourney === 'new';
    if (isSignup) {
      if (passwordConfirmAuth !== pw) {
        toast.error('As senhas não coincidem.');
        return;
      }
    }
    if (landingLayout) {
      trackLandingEvent('landing_login_click', {
        login_kind: isSignup ? 'email_signup' : 'email_signin'
      });
    }
    setTrialSessionForManager(isSignup ? 'trial' : 'customer');
    setLoading(isSignup ? 'email-signup' : 'email-signin');
    try {
      if (isSignup) await signUpWithEmailPassword(em, pw);
      else await signInWithEmailPassword(em, pw);
      setPasswordAuth('');
      setPasswordConfirmAuth('');
    } catch {
      /* toast já exibido em AuthContext */
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
      sessionStorage.removeItem('zapmass.startTrialAfterLogin');
      sessionStorage.removeItem('zapmass.tryTrialIfNeededAfterLogin');
    } catch {
      /* ignore */
    }
    setLoading('staff');
    try {
      const r = await fetch('/api/workspace/staff/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          managerEmail: me,
          loginName: slug,
          password: staffPassword
        })
      });
      const data = (await r.json()) as { ok?: boolean; error?: string; customToken?: string };
      if (!data?.ok || typeof data.customToken !== 'string') {
        toast.error(typeof data?.error === 'string' ? data.error : 'Não foi possível entrar.');
        return;
      }
      await signInWithStaffCustomToken(data.customToken);
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
      className="landing-card-glow relative w-full overflow-hidden rounded-[1.65rem] ring-1 ring-white/[0.06]"
      style={{
        background: 'var(--surface-0)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-lg, 0 22px 55px rgba(0,0,0,0.22))'
      }}
    >
      <div
        className="h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500 opacity-[0.92]"
        aria-hidden
      />
      <div className="relative z-[1] p-6 sm:p-8">
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

        <h2 className="mb-2 text-[1.35rem] font-extrabold leading-tight tracking-tight sm:text-[1.45rem]" style={{ color: 'var(--text-1)' }}>
          {title}
        </h2>
        <p className="mb-7 max-w-[42ch] text-[13px] leading-relaxed sm:max-w-none" style={{ color: 'var(--text-3)' }}>
          {subtitle}
        </p>

        {/* Quem entra: gestor (OAuth) ou funcionário (usuário + senha criados pelo gestor) */}
        <div
          className="mb-6 flex gap-1.5 rounded-2xl p-1.5"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' }}
          role="tablist"
          aria-label="Tipo de acesso"
        >
          <button
            type="button"
            role="tab"
            aria-selected={entryMode === 'admin'}
            onClick={() => setEntryMode('admin')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-3 text-[12.5px] font-bold transition-all duration-200 ${
              entryMode === 'admin' ? 'shadow-[0_4px_20px_rgba(0,0,0,0.07)]' : 'opacity-80 hover:opacity-100'
            }`}
            style={{
              background: entryMode === 'admin' ? 'var(--surface-0)' : 'transparent',
              color: 'var(--text-1)',
              border: entryMode === 'admin' ? '1px solid var(--border-subtle)' : '1px solid transparent'
            }}
          >
            <Zap className="h-4 w-4 shrink-0 text-emerald-500" />
            Responsável
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={entryMode === 'staff'}
            onClick={() => setEntryMode('staff')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-3 text-[12.5px] font-bold transition-all duration-200 ${
              entryMode === 'staff' ? 'shadow-[0_4px_20px_rgba(0,0,0,0.07)]' : 'opacity-80 hover:opacity-100'
            }`}
            style={{
              background: entryMode === 'staff' ? 'var(--surface-0)' : 'transparent',
              color: 'var(--text-1)',
              border: entryMode === 'staff' ? '1px solid var(--border-subtle)' : '1px solid transparent'
            }}
          >
            <Users className="h-4 w-4 shrink-0 text-sky-500" />
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
              primeira vez (Google, Apple, Facebook ou e-mail e senha).
            </p>
          </div>
        ) : (
          <>
            <div
              className="space-y-5 rounded-2xl p-4 sm:space-y-6 sm:p-5"
              style={{
                background:
                  'linear-gradient(155deg, rgba(16,185,129,0.08) 0%, var(--surface-1) 45%, var(--surface-0) 100%)',
                border: '1px solid rgba(16,185,129,0.16)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)'
              }}
            >
              <div
                className="flex gap-1.5 rounded-2xl p-1.5"
                style={{
                  background: 'var(--surface-0)',
                  border: '1px solid var(--border-subtle)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)'
                }}
                role="tablist"
                aria-label="Primeira vez ou conta existente"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={managerJourney === 'new'}
                  onClick={() => setManagerJourney('new')}
                  disabled={busy}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 pl-2 pr-2 text-center text-[11.5px] font-bold leading-tight transition-all duration-200 sm:gap-2 sm:px-3 sm:text-[12px] ${
                    managerJourney === 'new' ? 'shadow-[0_3px_16px_rgba(0,0,0,0.06)]' : 'opacity-75 hover:opacity-100'
                  }`}
                  style={{
                    background: managerJourney === 'new' ? 'var(--surface-1)' : 'transparent',
                    color: 'var(--text-1)',
                    border: managerJourney === 'new' ? '1px solid var(--border-subtle)' : '1px solid transparent'
                  }}
                >
                  <UserPlus className="h-4 w-4 shrink-0 text-emerald-500" />
                  <span className="min-w-0">Primeira vez aqui</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={managerJourney === 'returning'}
                  onClick={() => setManagerJourney('returning')}
                  disabled={busy}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 pl-2 pr-2 text-center text-[11.5px] font-bold leading-tight transition-all duration-200 sm:gap-2 sm:px-3 sm:text-[12px] ${
                    managerJourney === 'returning' ? 'shadow-[0_3px_16px_rgba(0,0,0,0.06)]' : 'opacity-75 hover:opacity-100'
                  }`}
                  style={{
                    background: managerJourney === 'returning' ? 'var(--surface-1)' : 'transparent',
                    color: 'var(--text-1)',
                    border: managerJourney === 'returning' ? '1px solid var(--border-subtle)' : '1px solid transparent'
                  }}
                >
                  <LogIn className="h-4 w-4 shrink-0 text-teal-600" />
                  <span className="min-w-0">Já tenho conta</span>
                </button>
              </div>

              <div
                className="rounded-xl px-3.5 py-3 text-[12px] leading-relaxed sm:px-4"
                style={{
                  background: 'rgba(16,185,129,0.07)',
                  border: '1px solid rgba(16,185,129,0.14)',
                  color: 'var(--text-2)'
                }}
              >
                {managerJourney === 'new'
                  ? showTrialOption
                    ? `Na primeira entrada, o teste grátis (${formatTrialHoursLabel(config.trialHours)}) é ativado com qualquer opção abaixo — rede social ou e-mail.`
                    : 'Crie sua conta com Google, Apple, Facebook ou com e-mail e senha.'
                  : 'Entre com a mesma conta que já usa no ZapMass.'}
              </div>

              <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onClick={() => void runOAuthLogin('google', oauthModeForManager)}
                  disabled={busy}
                  className="flex min-h-[5.25rem] flex-col items-center justify-center gap-2 rounded-2xl px-1 py-3.5 text-[10px] font-bold transition-all hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 disabled:opacity-60 sm:text-[11px]"
                  style={{
                    background: '#fff',
                    color: '#111',
                    border: '1px solid #e5e7eb',
                    boxShadow: '0 6px 20px rgba(0,0,0,0.07)'
                  }}
                >
                  {oauthSpin(loading, 'google', oauthModeForManager) ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <GoogleLogo />
                  )}
                  Google
                </button>
                <button
                  type="button"
                  onClick={() => void runOAuthLogin('facebook', oauthModeForManager)}
                  disabled={busy}
                  className="flex min-h-[5.25rem] flex-col items-center justify-center gap-2 rounded-2xl px-1 py-3.5 text-[10px] font-bold text-white transition-all hover:-translate-y-0.5 hover:brightness-110 hover:shadow-lg active:translate-y-0 disabled:opacity-60 sm:text-[11px]"
                  style={{ background: '#1877F2', boxShadow: '0 8px 22px rgba(24,119,242,0.32)' }}
                >
                  {oauthSpin(loading, 'facebook', oauthModeForManager) ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <FacebookLogo tone="light" />
                  )}
                  Facebook
                </button>
                <button
                  type="button"
                  onClick={() => void runOAuthLogin('apple', oauthModeForManager)}
                  disabled={busy}
                  className="flex min-h-[5.25rem] flex-col items-center justify-center gap-2 rounded-2xl px-1 py-3.5 text-[10px] font-bold text-white transition-all hover:-translate-y-0.5 hover:opacity-95 hover:shadow-lg active:translate-y-0 disabled:opacity-60 sm:text-[11px]"
                  style={{ background: '#000', border: '1px solid #333', boxShadow: '0 8px 22px rgba(0,0,0,0.25)' }}
                >
                  {oauthSpin(loading, 'apple', oauthModeForManager) ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <AppleLogo tone="light" />
                  )}
                  Apple
                </button>
              </div>

              {landingLayout && showTrialOption && managerJourney === 'new' && (
                <p className="text-center text-[11px] font-medium sm:-mt-1" style={{ color: 'var(--text-2)' }}>
                  {formatTrialHoursLabel(config.trialHours)} com tudo liberado · sem cartão
                </p>
              )}

              <div className="flex items-center gap-3 py-0.5">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent to-[var(--border-subtle)] opacity-80" />
                <span
                  className="whitespace-nowrap px-2 text-[9.5px] font-bold uppercase tracking-[0.14em] sm:text-[10px]"
                  style={{ color: 'var(--text-3)' }}
                >
                  ou e-mail e senha
                </span>
                <div className="h-px flex-1 bg-gradient-to-l from-transparent to-[var(--border-subtle)] opacity-80" />
              </div>

              <div className="space-y-3.5">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                    E-mail
                  </label>
                  <input
                    type="email"
                    autoComplete="email"
                    value={emailAuth}
                    onChange={(e) => setEmailAuth(e.target.value)}
                    disabled={busy}
                    placeholder="voce@email.com"
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
                    Senha
                  </label>
                  <input
                    type="password"
                    autoComplete={managerJourney === 'new' ? 'new-password' : 'current-password'}
                    value={passwordAuth}
                    onChange={(e) => setPasswordAuth(e.target.value)}
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
                {managerJourney === 'new' && (
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                      Confirmar senha
                    </label>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={passwordConfirmAuth}
                      onChange={(e) => setPasswordConfirmAuth(e.target.value)}
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
                )}
                <button
                  type="button"
                  onClick={() => void runManagerEmailAuth()}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-[13px] font-bold text-white transition-all hover:brightness-110 disabled:opacity-60"
                  style={{
                    background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)',
                    boxShadow: '0 10px 24px rgba(13,148,136,0.28)'
                  }}
                >
                  {loading === 'email-signup' || loading === 'email-signin' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {loading === 'email-signup' ? 'Criando…' : 'Entrando…'}
                    </>
                  ) : (
                    <>
                      <Mail className="h-4 w-4" />
                      {managerJourney === 'new' ? 'Criar conta com e-mail' : 'Entrar com e-mail'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}

        {landingLayout ? (
          <details
            className="group mt-6 overflow-hidden rounded-2xl border"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-[12px] font-semibold select-none transition-colors hover:bg-black/[0.04]">
              <Lock className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-600)' }} />
              <span style={{ color: 'var(--text-2)' }}>Como funciona o acesso e a segurança</span>
              <span className="ml-auto text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                Ver
              </span>
            </summary>
            <div className="px-3 pb-3 pt-0 space-y-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              {entryMode === 'admin' ? (
                <>
                  <Feature
                    icon={<ShieldCheck className="w-3.5 h-3.5" />}
                    label="Responsável: Google, Apple, Facebook ou e-mail/senha (Firebase). Funcionários: aba Funcionário."
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
                    label="Responsável: Google, Apple, Facebook ou e-mail e senha — escolha primeira vez ou já tenho conta."
                  />
                  <Feature icon={<Zap className="w-3.5 h-3.5" />} label="Sessão persistente: entra uma vez e fica logado" />
                </>
              ) : (
                <>
                  <Feature
                    icon={<Lock className="w-3.5 h-3.5" />}
                    label="Senha de funcionário validada no servidor (Firebase Auth) e ligada à conta do gestor."
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

const FacebookLogo: React.FC<{ tone?: 'light' | 'brand' }> = ({ tone = 'brand' }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    style={{ color: tone === 'light' ? '#fff' : '#1877F2' }}
  >
    <path
      fill="currentColor"
      d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
    />
  </svg>
);

const AppleLogo: React.FC<{ tone?: 'light' | 'dark' }> = ({ tone = 'dark' }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    style={{ color: tone === 'light' ? '#fff' : '#000' }}
  >
    <path
      fill="currentColor"
      d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"
    />
  </svg>
);

const GoogleLogo: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.997 10.997 0 0 0 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09A6.58 6.58 0 0 1 5.5 12c0-.73.12-1.43.34-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l3.66-2.84z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
    />
  </svg>
);
