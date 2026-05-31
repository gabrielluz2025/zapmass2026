import React, { useState } from 'react';
import { fetchSignInMethodsForEmail } from 'firebase/auth';
import { Loader2, Lock, Mail, ShieldCheck, Sparkles, Users, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { auth } from '../../services/firebase';
import { useAppConfig } from '../../context/AppConfigContext';
import { formatTrialHoursLabel } from '../../utils/trialCopy';
import { trackLandingEvent } from '../../utils/marketingEvents';
import { apiUrl } from '../../utils/apiBase';
import { clearTrialSessionFlags, setTrialSessionForManager } from '../../utils/trialSession';

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
    signInWithGoogle,
    signInWithFacebook,
    signInWithEmailPassword,
    signUpWithEmailPassword,
    signInWithStaffCustomToken
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

  const runOAuthLogin = async (provider: 'google' | 'facebook') => {
    if (landingLayout) {
      trackLandingEvent('landing_login_click', { login_kind: `${provider}_auto` });
    }
    setTrialSessionForManager('customer');
    setLoading(`oauth:${provider}:customer` as LoadingState);
    try {
      if (provider === 'google') await signInWithGoogle();
      else await signInWithFacebook();
    } finally {
      setLoading('idle');
    }
  };

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

    let methods: string[];
    try {
      methods = await fetchSignInMethodsForEmail(auth, em);
    } catch {
      /** Proteção contra enumeração do Firebase: tenta entrar; se não existir, cadastra. */
      setTrialSessionForManager(showTrialOption ? 'trial' : 'customer');
      setLoading('email-signin');
      try {
        await signInWithEmailPassword(em, pw);
        setPasswordAuth('');
        setPasswordConfirmAuth('');
        return;
      } catch {
        /* AuthContext já mostrou erro — segue para cadastro se senhas baterem */
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
      return;
    }

    const hasPassword = methods.includes('password');
    const oauthOnly = methods.filter((m) => m !== 'password');

    if (!hasPassword && oauthOnly.length > 0) {
      const one = oauthOnly.length === 1 ? oauthOnly[0] : null;
      const label =
        one === 'google.com' ? 'Google' : one === 'facebook.com' ? 'Facebook' : null;
      toast.error(
        label
          ? `Este e-mail já está ligado a ${label}. Use o botão correspondente abaixo.`
          : 'Este e-mail já está ligado a outro método de login. Use o botão da rede social correspondente.'
      );
      return;
    }

    if (hasPassword) {
      if (landingLayout) {
        trackLandingEvent('landing_login_click', { login_kind: 'email_signin' });
      }
      setTrialSessionForManager('customer');
      setLoading('email-signin');
      try {
        await signInWithEmailPassword(em, pw);
        setPasswordAuth('');
        setPasswordConfirmAuth('');
      } catch {
        /* toast já exibido em AuthContext */
      } finally {
        setLoading('idle');
      }
      return;
    }

    if (passwordConfirmAuth !== pw) {
      toast.error('As senhas não coincidem.');
      return;
    }
    if (landingLayout) {
      trackLandingEvent('landing_login_click', { login_kind: 'email_signup' });
    }
    setTrialSessionForManager('trial');
    setLoading('email-signup');
    try {
      await signUpWithEmailPassword(em, pw);
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
      clearTrialSessionFlags();
    } catch {
      /* ignore */
    }
    setLoading('staff');
    try {
      const r = await fetch(apiUrl('/api/workspace/staff/sign-in'), {
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

              <div className={`flex items-center gap-2 ${landingLayout ? '' : 'py-0.5'}`}>
                <div className="h-px flex-1 opacity-50" style={{ background: 'var(--border-subtle)' }} />
                <span className={`whitespace-nowrap px-1 font-medium ${landingLayout ? 'text-[9px]' : 'text-[9.5px]'}`} style={{ color: 'var(--text-3)' }}>
                  ou continue com
                </span>
                <div className="h-px flex-1 opacity-50" style={{ background: 'var(--border-subtle)' }} />
              </div>

              <div className={`flex items-center justify-center ${landingLayout ? 'gap-2' : 'gap-2.5 sm:gap-3'}`} role="group" aria-label="Entrar com rede social">
                <button
                  type="button"
                  title="Google"
                  aria-label="Continuar com Google"
                  onClick={() => void runOAuthLogin('google')}
                  disabled={busy}
                  className={`flex shrink-0 items-center justify-center rounded-full border transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35 disabled:opacity-55 disabled:hover:translate-y-0 ${
                    landingLayout ? 'h-8 w-8' : 'h-10 w-10 sm:h-11 sm:w-11'
                  }`}
                  style={{
                    background: '#ffffff',
                    borderColor: 'rgba(0,0,0,0.08)',
                    boxShadow: '0 1px 5px rgba(0,0,0,0.05)'
                  }}
                >
                  {oauthSpin(loading, 'google') ? (
                    <Loader2 className="h-3 w-3 animate-spin text-zinc-600" />
                  ) : (
                    <GoogleLogo size={landingLayout ? 14 : 18} />
                  )}
                </button>
                <button
                  type="button"
                  title="Facebook"
                  aria-label="Continuar com Facebook"
                  onClick={() => void runOAuthLogin('facebook')}
                  disabled={busy}
                  className={`flex shrink-0 items-center justify-center rounded-full text-white transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40 disabled:opacity-55 disabled:hover:translate-y-0 ${
                    landingLayout ? 'h-8 w-8' : 'h-10 w-10 sm:h-11 sm:w-11'
                  }`}
                  style={{ background: '#1877F2', boxShadow: '0 2px 7px rgba(24,119,242,0.22)' }}
                >
                  {oauthSpin(loading, 'facebook') ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <FacebookLogo tone="light" size={landingLayout ? 14 : 18} />
                  )}
                </button>
              </div>
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
                    label="Responsável: Google, Facebook ou e-mail/senha (Firebase). Funcionários: aba Funcionário."
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
                    label="Responsável: Google, Facebook ou e-mail e senha — o sistema reconhece conta nova ou existente."
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

const FacebookLogo: React.FC<{ tone?: 'light' | 'brand'; size?: number }> = ({ tone = 'brand', size = 18 }) => (
  <svg
    width={size}
    height={size}
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

const GoogleLogo: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
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
