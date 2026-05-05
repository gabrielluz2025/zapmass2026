import React, { useState } from 'react';
import { Loader2, Lock, ShieldCheck, Sparkles, Users, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { formatTrialHoursLabel } from '../../utils/trialCopy';
import { trackLandingEvent } from '../../utils/marketingEvents';

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
  | 'oauth:apple:customer';

const oauthSpin = (loading: LoadingState, provider: OauthPid, mode: 'trial' | 'customer') =>
  loading === (`oauth:${provider}:${mode}` as LoadingState);

export const LoginCard: React.FC<LoginCardProps> = ({
  title = 'Entre na sua conta',
  subtitle = 'Acesse com Google, Apple ou Facebook — um clique para entrar e começar seu teste sem complicação.',
  showTrialOption = false,
  landingLayout = false
}) => {
  const { signInWithGoogle, signInWithFacebook, signInWithApple, signInWithStaffCustomToken } = useAuth();
  const { config } = useAppConfig();
  const [entryMode, setEntryMode] = useState<'admin' | 'staff'>('admin');
  const [loading, setLoading] = useState<LoadingState>('idle');

  const [managerEmail, setManagerEmail] = useState('');
  const [staffLoginName, setStaffLoginName] = useState('');
  const [staffPassword, setStaffPassword] = useState('');

  const trialBtn = landingLayout
    ? 'Começar grátis com Google'
    : `Entrar com Google e iniciar teste grátis (${formatTrialHoursLabel(config.trialHours)})`;

  const runOAuthLogin = async (provider: 'google' | 'facebook' | 'apple', mode: 'trial' | 'customer') => {
    if (landingLayout) {
      trackLandingEvent('landing_login_click', {
        login_kind:
          mode === 'trial' ? `${provider}_trial` : `${provider}_existing`
      });
    }
    if (mode === 'trial') {
      try {
        sessionStorage.setItem('zapmass.startTrialAfterLogin', '1');
        sessionStorage.removeItem('zapmass.tryTrialIfNeededAfterLogin');
      } catch {
        /* ignore */
      }
    } else {
      try {
        sessionStorage.removeItem('zapmass.startTrialAfterLogin');
        sessionStorage.setItem('zapmass.tryTrialIfNeededAfterLogin', '1');
      } catch {
        /* ignore */
      }
    }
    setLoading(`oauth:${provider}:${mode}` as LoadingState);
    try {
      if (provider === 'google') await signInWithGoogle();
      else if (provider === 'facebook') await signInWithFacebook();
      else await signInWithApple();
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
      className="landing-card-glow rounded-2xl p-6 sm:p-7 relative w-full"
      style={{
        background: 'var(--surface-0)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-lg, 0 20px 50px rgba(0,0,0,0.18))'
      }}
    >
      <div className="relative z-[1]">
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

        <h2 className="text-[22px] font-extrabold leading-tight mb-1.5" style={{ color: 'var(--text-1)' }}>
          {title}
        </h2>
        <p className="text-[13px] leading-relaxed mb-5" style={{ color: 'var(--text-3)' }}>
          {subtitle}
        </p>

        {/* Quem entra: gestor (OAuth) ou funcionário (usuário + senha criados pelo gestor) */}
        <div
          className="flex rounded-xl p-1 mb-5 gap-1"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
          role="tablist"
          aria-label="Tipo de acesso"
        >
          <button
            type="button"
            role="tab"
            aria-selected={entryMode === 'admin'}
            onClick={() => setEntryMode('admin')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-[12.5px] font-bold transition-colors ${
              entryMode === 'admin' ? 'shadow-sm' : 'opacity-85'
            }`}
            style={{
              background: entryMode === 'admin' ? 'var(--surface-0)' : 'transparent',
              color: 'var(--text-1)',
              border: entryMode === 'admin' ? '1px solid var(--border-subtle)' : '1px solid transparent'
            }}
          >
            <Zap className="w-4 h-4 text-emerald-600" />
            Responsável
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={entryMode === 'staff'}
            onClick={() => setEntryMode('staff')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-[12.5px] font-bold transition-colors ${
              entryMode === 'staff' ? 'shadow-sm' : 'opacity-85'
            }`}
            style={{
              background: entryMode === 'staff' ? 'var(--surface-0)' : 'transparent',
              color: 'var(--text-1)',
              border: entryMode === 'staff' ? '1px solid var(--border-subtle)' : '1px solid transparent'
            }}
          >
            <Users className="w-4 h-4 text-sky-600" />
            Funcionário
          </button>
        </div>

        {entryMode === 'staff' ? (
          <div className="space-y-3 mb-2">
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-2)' }}>
              O responsável cria o seu usuário e senha na área{' '}
              <strong>Funcionários</strong> do painel. Use o <strong>e-mail principal do gestor</strong> (o mesmo da conta dele
              no ZapMass) e o usuário que criou para você.
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
                className="mt-1 w-full rounded-lg px-3 py-2.5 text-[13px]"
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
                className="mt-1 w-full rounded-lg px-3 py-2.5 text-[13px] font-mono"
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
                className="mt-1 w-full rounded-lg px-3 py-2.5 text-[13px]"
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
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl font-bold text-[14px] text-white transition-all hover:brightness-110 disabled:opacity-60"
              style={{
                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                boxShadow: '0 12px 28px rgba(2,132,199,0.3)'
              }}
            >
              {loading === 'staff' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Entrando…
                </>
              ) : (
                <>
                  <Users className="w-4 h-4" />
                  Entrar como funcionário
                </>
              )}
            </button>
            <p className="text-[11px] leading-snug pt-1" style={{ color: 'var(--text-3)' }}>
              Este acesso usa a assinatura da conta do gestor. O teste grátis só é ativado quando o responsável entra pela
              primeira vez com Google, Apple ou Facebook.
            </p>
          </div>
        ) : showTrialOption ? (
          <>
            <button
              type="button"
              onClick={() => void runOAuthLogin('google', 'trial')}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl font-bold text-[14px] text-white transition-all hover:brightness-110 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 55%, #047857 100%)',
                boxShadow: '0 14px 32px rgba(16,185,129,0.35)'
              }}
            >
              {oauthSpin(loading, 'google', 'trial') ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Conectando…
                </>
              ) : (
                <>
                  <GoogleLogo />
                  {trialBtn}
                </>
              )}
            </button>
            {landingLayout ? (
              <p className="text-[11px] mt-2 text-center font-medium" style={{ color: 'var(--text-2)' }}>
                {formatTrialHoursLabel(config.trialHours)} com tudo liberado · sem cartão
              </p>
            ) : (
              <p className="text-[11.5px] mt-2 text-center" style={{ color: 'var(--text-3)' }}>
                No primeiro acesso, o teste grátis ativa automaticamente (Google, Apple ou Facebook).
              </p>
            )}
            <button
              type="button"
              onClick={() => void runOAuthLogin('google', 'customer')}
              disabled={busy}
              className="w-full mt-2.5 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[12.5px] font-semibold transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: 'var(--surface-1)',
                color: 'var(--text-2)',
                border: '1px solid var(--border-subtle)'
              }}
            >
              {oauthSpin(loading, 'google', 'customer') ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Entrando…
                </>
              ) : (
                <>
                  <GoogleLogo />
                  Já sou cliente — acessar painel
                </>
              )}
            </button>

            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                Ou continue com
              </span>
              <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
            </div>
            <p className="text-[11px] font-semibold text-center mb-2" style={{ color: 'var(--text-2)' }}>
              Começar grátis
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void runOAuthLogin('facebook', 'trial')}
                disabled={busy}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[12px] font-bold text-white transition-all disabled:opacity-60"
                style={{ background: '#1877F2', boxShadow: '0 8px 20px rgba(24,119,242,0.25)' }}
              >
                {oauthSpin(loading, 'facebook', 'trial') ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FacebookLogo tone="light" />
                )}
                {landingLayout ? 'Facebook — grátis' : 'Grátis com Facebook'}
              </button>
              <button
                type="button"
                onClick={() => void runOAuthLogin('apple', 'trial')}
                disabled={busy}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[12px] font-bold text-white transition-all disabled:opacity-60"
                style={{ background: '#000', boxShadow: '0 8px 20px rgba(0,0,0,0.2)' }}
              >
                {oauthSpin(loading, 'apple', 'trial') ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <AppleLogo tone="light" />
                )}
                {landingLayout ? 'Apple — grátis' : 'Grátis com Apple'}
              </button>
            </div>
            <p className="text-[11px] text-center mt-3 mb-1.5 font-medium" style={{ color: 'var(--text-3)' }}>
              Já sou cliente
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void runOAuthLogin('facebook', 'customer')}
                disabled={busy}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[12px] font-semibold transition-all disabled:opacity-60"
                style={{
                  background: 'var(--surface-1)',
                  color: 'var(--text-2)',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                {oauthSpin(loading, 'facebook', 'customer') ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FacebookLogo />
                )}
                Facebook
              </button>
              <button
                type="button"
                onClick={() => void runOAuthLogin('apple', 'customer')}
                disabled={busy}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[12px] font-semibold transition-all disabled:opacity-60"
                style={{
                  background: 'var(--surface-1)',
                  color: 'var(--text-2)',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                {oauthSpin(loading, 'apple', 'customer') ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <AppleLogo />
                )}
                Apple
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => void runOAuthLogin('google', 'customer')}
              disabled={busy}
              className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-xl font-semibold text-[14px] transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: '#fff',
                color: '#111',
                border: '1px solid #e5e7eb',
                boxShadow: '0 4px 16px rgba(0,0,0,0.08)'
              }}
            >
              {oauthSpin(loading, 'google', 'customer') ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Conectando…
                </>
              ) : (
                <>
                  <GoogleLogo />
                  Entrar com Google
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => void runOAuthLogin('facebook', 'customer')}
              disabled={busy}
              className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-xl font-semibold text-[14px] text-white transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
              style={{
                background: '#1877F2',
                border: '1px solid rgba(0,0,0,0.06)',
                boxShadow: '0 6px 18px rgba(24,119,242,0.28)'
              }}
            >
              {oauthSpin(loading, 'facebook', 'customer') ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Conectando…
                </>
              ) : (
                <>
                  <FacebookLogo tone="light" />
                  Entrar com Facebook
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => void runOAuthLogin('apple', 'customer')}
              disabled={busy}
              className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-xl font-semibold text-[14px] text-white transition-all hover:opacity-95 active:scale-[0.99] disabled:opacity-60"
              style={{
                background: '#000',
                border: '1px solid #333',
                boxShadow: '0 6px 18px rgba(0,0,0,0.2)'
              }}
            >
              {oauthSpin(loading, 'apple', 'customer') ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Conectando…
                </>
              ) : (
                <>
                  <AppleLogo tone="light" />
                  Entrar com Apple
                </>
              )}
            </button>
          </div>
        )}

        {landingLayout ? (
          <details className="mt-5 rounded-xl border overflow-hidden group" style={{ borderColor: 'var(--border-subtle)' }}>
            <summary className="flex items-center gap-2 px-3 py-2.5 cursor-pointer list-none text-[12px] font-semibold select-none hover:bg-black/[0.03]">
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
                    label="Responsável: login com Google, Apple ou Facebook (OAuth) — sem criar senha no ZapMass"
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
                    label="Responsável: login com Google, Apple ou Facebook (OAuth) — sem senha nosso"
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
