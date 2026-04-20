import React from 'react';
import { Zap } from 'lucide-react';
import { LoginCard } from './auth/LoginCard';

/** Tela de login isolada (ex.: rota direta). A entrada principal do app usa {@link PreLoginLanding}. */
export const LoginScreen: React.FC = () => {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-10 relative overflow-hidden"
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 20% 20%, rgba(16,185,129,0.12) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(59,130,246,0.08) 0%, transparent 50%)'
        }}
      />
      <div className="relative w-full max-w-md">
        <div className="flex items-center justify-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg"
            style={{
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              boxShadow: '0 12px 40px rgba(16,185,129,0.35)'
            }}
          >
            <Zap className="w-7 h-7 text-white fill-white" />
          </div>
          <div className="ml-3">
            <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
              ZapMass
            </h1>
            <p className="text-[11.5px] font-semibold" style={{ color: 'var(--brand-600)' }}>
              SaaS Premium
            </p>
          </div>
        </div>
        <LoginCard showTrialOption />
        <p className="text-[11px] text-center mt-5" style={{ color: 'var(--text-3)' }}>
          Ao entrar, voce concorda em usar o ZapMass de acordo com as politicas internas.
        </p>
      </div>
    </div>
  );
};
