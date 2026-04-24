import React, { useState } from 'react';
import { Loader2, Lock, ShieldCheck, Sparkles, Zap } from 'lucide-react';
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
  subtitle = 'Acesse o painel de disparos, conexões e campanhas em 1 clique com sua conta Google.',
  showTrialOption = false
}) => {
  const { signInWithGoogle } = useAuth();
  const { config } = useAppConfig();
  const [loading, setLoading] = useState<'idle' | 'login' | 'trial'>('idle');
  const trialBtn = `Entrar com Google e iniciar teste grátis (${formatTrialHoursLabel(config.trialHours)})`;

  const runLogin = async (trialAfter: boolean) => {
    if (trialAfter) {
      try {
        sessionStorage.setItem('zapmass.startTrialAfterLogin', '1');
      } catch {
        /* ignore */
      }
    } else {
      try {
        sessionStorage.removeItem('zapmass.startTrialAfterLogin');
      } catch {
        /* ignore */
      }
    }
    setLoading(trialAfter ? 'trial' : 'login');
    try {
      await signInWithGoogle();
    } finally {
      setLoading('idle');
    }
  };

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
        {/* Badge topo */}
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
        <p className="text-[13px] leading-relaxed mb-6" style={{ color: 'var(--text-3)' }}>
          {subtitle}
        </p>

        {/* CTA principal unificado */}
        {showTrialOption ? (
          <>
            <button
              type="button"
              onClick={() => runLogin(true)}
              disabled={loading !== 'idle'}
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
              onClick={() => runLogin(false)}
              disabled={loading !== 'idle'}
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
                  Já sou cliente — entrar direto
                </>
              )}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => runLogin(false)}
            disabled={loading !== 'idle'}
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
          <span className="inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
            <Lock className="w-3 h-3" />
            Entrada segura
          </span>
          <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
        </div>

        {/* Trust features */}
        <div className="space-y-2">
          <Feature icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Nunca guardamos sua senha — login é pelo Google" />
          <Feature icon={<Zap className="w-3.5 h-3.5" />} label="Sessão persistente: entra uma vez e fica logado" />
          <Feature icon={<Sparkles className="w-3.5 h-3.5" />} label="Cancela quando quiser — sem fidelidade" />
        </div>
      </div>
    </div>
  );
};

const Feature: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
  <div
    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg"
    style={{ background: 'var(--surface-1)' }}
  >
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
