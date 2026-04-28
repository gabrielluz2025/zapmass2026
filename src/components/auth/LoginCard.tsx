import React, { useState } from 'react';
import { Loader2, Lock, ShieldCheck, Sparkles, Users, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { formatTrialHoursLabel } from '../../utils/trialCopy';

interface LoginCardProps {
  title?: string;
  subtitle?: string;
  /** Quando true, o CTA principal ja inicia o teste apos login (fluxo unificado). */
  showTrialOption?: boolean;
}

export const LoginCard: React.FC<LoginCardProps> = ({
  title = 'Entre na sua conta',
  subtitle = 'Acesse sua operação com 1 clique no Google e comece seu teste sem complicação.',
  showTrialOption = false
}) => {
  const { signInWithGoogle, signInWithStaffCustomToken } = useAuth();
  const { config } = useAppConfig();
  const [entryMode, setEntryMode] = useState<'admin' | 'staff'>('admin');
  const [loading, setLoading] = useState<'idle' | 'login' | 'trial' | 'staff'>('idle');

  const [managerEmail, setManagerEmail] = useState('');
  const [staffLoginName, setStaffLoginName] = useState('');
  const [staffPassword, setStaffPassword] = useState('');

  const trialBtn = `Entrar com Google e iniciar teste grátis (${formatTrialHoursLabel(config.trialHours)})`;

  const runLogin = async (mode: 'trial' | 'customer') => {
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
    setLoading(mode === 'trial' ? 'trial' : 'login');
    try {
      await signInWithGoogle();
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

        <h2 className="text-[22px] font-extrabold leading-tight mb-1.5" style={{ color: 'var(--text-1)' }}>
          {title}
        </h2>
        <p className="text-[13px] leading-relaxed mb-5" style={{ color: 'var(--text-3)' }}>
          {subtitle}
        </p>

        {/* Quem entra: gestor (Google) ou funcionário (usuário + senha criados pelo gestor) */}
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
              <strong>Funcionários</strong> do painel. Use o <strong>e-mail dele (Google)</strong> e o usuário que criou para
              você.
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
              Este acesso usa a assinatura da conta do gestor. Teste grátis só é ativado quando o responsável entra com
              Google pela primeira vez.
            </p>
          </div>
        ) : showTrialOption ? (
          <>
            <button
              type="button"
              onClick={() => runLogin('trial')}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl font-bold text-[14px] text-white transition-all hover:brightness-110 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 55%, #047857 100%)',
                boxShadow: '0 14px 32px rgba(16,185,129,0.35)'
              }}
            >
              {loading === 'trial' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Abrindo Google…
                </>
              ) : (
                <>
                  <GoogleLogo />
                  {trialBtn}
                </>
              )}
            </button>
            <p className="text-[11.5px] mt-2 text-center" style={{ color: 'var(--text-3)' }}>
              Fluxo único: você entra com Google e o teste é ativado automaticamente no primeiro acesso.
            </p>
            <button
              type="button"
              onClick={() => runLogin('customer')}
              disabled={busy}
              className="w-full mt-2.5 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[12.5px] font-semibold transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: 'var(--surface-1)',
                color: 'var(--text-2)',
                border: '1px solid var(--border-subtle)'
              }}
            >
              {loading === 'login' ? (
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
          </>
        ) : (
          <button
            type="button"
            onClick={() => runLogin('customer')}
            disabled={busy}
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-xl font-semibold text-[14px] transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              background: '#fff',
              color: '#111',
              border: '1px solid #e5e7eb',
              boxShadow: '0 4px 16px rgba(0,0,0,0.08)'
            }}
          >
            {loading === 'login' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Entrando…
              </>
            ) : (
              <>
                <GoogleLogo />
                Entrar com Google
              </>
            )}
          </button>
        )}

        {/* Divider */}
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
              <Feature icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Responsável: login com Google (OAuth) — sem senha nosso" />
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
