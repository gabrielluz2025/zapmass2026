import React from 'react';
import {
  BarChart3,
  CheckCircle2,
  MessageCircle,
  Rocket,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  Zap
} from 'lucide-react';
import { LoginCard } from './auth/LoginCard';
import { useAppConfig } from '../context/AppConfigContext';
import { formatTrialDurationPhrase, formatTrialHoursLabel } from '../utils/trialCopy';
import { LandingWhatsAppRiskNotice } from './legal/LandingWhatsAppRiskNotice';

export const PreLoginLanding: React.FC = () => {
  const { config } = useAppConfig();
  const trialTitle =
    config.landingTrialTitle.trim() ||
    `Experimente ${formatTrialHoursLabel(config.trialHours)} gratis`;
  const trialBody =
    config.landingTrialBody.trim() ||
    `Acesso completo ao sistema durante ${formatTrialDurationPhrase(config.trialHours)}. Depois voce continua dentro do app para explorar telas, mas as acoes ficam bloqueadas ate assinar o Pro — plano mensal ou anual, com renovacao por mes calendario (respeitando meses com mais ou menos dias).`;

  return (
    <div
      className="min-h-screen relative overflow-x-hidden"
      style={{ background: 'var(--bg)' }}
    >
      {/* Aurora / orbs */}
      <div
        aria-hidden
        className="absolute top-[-160px] left-[-160px] w-[520px] h-[520px] rounded-full pointer-events-none animate-blob"
        style={{
          background:
            'radial-gradient(circle at 30% 30%, rgba(16,185,129,0.35), rgba(16,185,129,0) 60%)',
          filter: 'blur(40px)'
        }}
      />
      <div
        aria-hidden
        className="absolute top-[10%] right-[-180px] w-[560px] h-[560px] rounded-full pointer-events-none animate-blob-slow"
        style={{
          background:
            'radial-gradient(circle at 60% 40%, rgba(59,130,246,0.28), rgba(59,130,246,0) 60%)',
          filter: 'blur(50px)'
        }}
      />
      <div
        aria-hidden
        className="absolute bottom-[-180px] left-[20%] w-[600px] h-[600px] rounded-full pointer-events-none animate-blob"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(34,211,238,0.18), rgba(34,211,238,0) 60%)',
          filter: 'blur(60px)'
        }}
      />

      {/* Grid sutil */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(var(--text-1) 1px, transparent 1px), linear-gradient(90deg, var(--text-1) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse at 50% 20%, #000 40%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 20%, #000 40%, transparent 80%)'
        }}
      />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-8 lg:py-14 lg:grid lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:items-start">
        {/* Header */}
        <header className="flex items-center justify-between mb-10 lg:mb-12 lg:col-span-2 animate-fade-in-up">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center animate-glow-pulse"
              style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' }}
            >
              <Zap className="w-6 h-6 text-white fill-white" />
            </div>
            <div>
              <h1 className="text-[20px] font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
                ZapMass
              </h1>
              <p className="text-[11.5px] font-semibold" style={{ color: 'var(--brand-600)' }}>
                Disparos em massa no WhatsApp, com organizacao
              </p>
            </div>
          </div>

          <div
            className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold border"
            style={{
              background: 'rgba(16,185,129,0.08)',
              borderColor: 'rgba(16,185,129,0.25)',
              color: 'var(--brand-600)'
            }}
          >
            <span className="relative flex w-2 h-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Plataforma online
          </div>
        </header>

        {/* Coluna esquerda */}
        <div className="lg:col-start-1 space-y-6 mb-10 lg:mb-0 animate-fade-in-up" style={{ animationDelay: '80ms' }}>
          <div
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-[11px] font-bold uppercase tracking-widest"
            style={{
              background: 'var(--surface-0)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--brand-600)'
            }}
          >
            <Sparkles className="w-3 h-3" />
            Plataforma SaaS
          </div>

          <h2
            className="text-4xl sm:text-5xl font-extrabold leading-[1.05] tracking-tight max-w-xl"
            style={{ color: 'var(--text-1)' }}
          >
            Centralize chips, campanhas e <span className="text-gradient-brand">contatos</span> em um so lugar.
          </h2>

          <p className="text-[15px] leading-relaxed max-w-lg" style={{ color: 'var(--text-2)' }}>
            O ZapMass foi feito para equipes que precisam escalar comunicacao no WhatsApp com controle de ritmo,
            listas, relatorios e central de mensagens — sem perder a visao do que cada numero esta fazendo.
          </p>

          {/* Highlights */}
          <div className="flex flex-wrap gap-2 pt-1">
            <Chip icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Login Firebase seguro" />
            <Chip icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Dados isolados por conta" />
            <Chip icon={<Sparkles className="w-3.5 h-3.5" />} label="Teste gratis imediato" />
          </div>

          {/* Features grid */}
          <ul className="grid sm:grid-cols-2 gap-3 pt-3">
            <Pitch
              icon={<Send className="w-4 h-4" />}
              title="Campanhas inteligentes"
              text="Disparos com limites, atrasos e pausa para respeitar o ritmo do WhatsApp."
            />
            <Pitch
              icon={<Users className="w-4 h-4" />}
              title="Base de contatos"
              text="Importacao, listas, etiquetas e historico para segmentar melhor."
            />
            <Pitch
              icon={<MessageCircle className="w-4 h-4" />}
              title="Central de chat"
              text="Responda conversas por chip, com contexto de campanha quando aplicavel."
            />
            <Pitch
              icon={<BarChart3 className="w-4 h-4" />}
              title="Relatorios"
              text="Acompanhe entregas, falhas e desempenho por conexao."
            />
          </ul>

          {/* Trial card destacado */}
          <div
            className="relative rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4 overflow-hidden"
            style={{
              background:
                'linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(16,185,129,0.04) 60%, rgba(59,130,246,0.08) 100%)',
              border: '1px solid rgba(16,185,129,0.28)'
            }}
          >
            <div
              aria-hidden
              className="absolute -top-10 -right-10 w-40 h-40 rounded-full pointer-events-none"
              style={{
                background: 'radial-gradient(circle, rgba(16,185,129,0.28), transparent 70%)',
                filter: 'blur(12px)'
              }}
            />
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 relative"
              style={{
                background: 'linear-gradient(135deg,#10b981,#059669)',
                boxShadow: '0 10px 30px rgba(16,185,129,0.35)'
              }}
            >
              <Rocket className="w-6 h-6 text-white" />
            </div>
            <div className="relative">
              <p className="text-[14.5px] font-extrabold" style={{ color: 'var(--text-1)' }}>
                {trialTitle}
              </p>
              <p className="text-[13px] leading-snug mt-1" style={{ color: 'var(--text-2)' }}>
                {trialBody}
              </p>
            </div>
          </div>
        </div>

        {/* Coluna direita (login) */}
        <div className="lg:col-start-2 space-y-4 animate-fade-in-up" style={{ animationDelay: '160ms' }}>
          <LandingWhatsAppRiskNotice />
          <LoginCard showTrialOption />
          <p className="text-[11px] text-center max-w-md mx-auto leading-snug" style={{ color: 'var(--text-3)' }}>
            Ao entrar, voce concorda em usar o ZapMass conforme as politicas do produto. O uso do WhatsApp envolve
            riscos de banimento e obrigacoes legais (ex.: LGPD): quem opera as listas e as mensagens e o cliente.
            Veja a aba <strong>Configuracoes → WhatsApp / LGPD</strong> apos o login.
          </p>
        </div>
      </div>
    </div>
  );
};

const Chip: React.FC<{ icon: React.ReactNode; label: string }> = ({ icon, label }) => (
  <span
    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold border"
    style={{
      background: 'var(--surface-0)',
      borderColor: 'var(--border-subtle)',
      color: 'var(--text-2)'
    }}
  >
    <span style={{ color: 'var(--brand-600)' }}>{icon}</span>
    {label}
  </span>
);

const Pitch: React.FC<{ icon: React.ReactNode; title: string; text: string }> = ({ icon, title, text }) => (
  <li
    className="group relative flex gap-3 rounded-xl p-3.5 border transition-all duration-200 hover:-translate-y-0.5"
    style={{
      background: 'var(--surface-0)',
      borderColor: 'var(--border-subtle)',
      boxShadow: 'var(--shadow-xs)'
    }}
  >
    <div
      className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-105"
      style={{
        background: 'linear-gradient(135deg, rgba(16,185,129,0.18), rgba(16,185,129,0.06))',
        color: 'var(--brand-600)',
        boxShadow: '0 4px 14px rgba(16,185,129,0.12)'
      }}
    >
      {icon}
    </div>
    <div className="min-w-0">
      <p className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
        {title}
      </p>
      <p className="text-[11.5px] leading-snug mt-0.5" style={{ color: 'var(--text-3)' }}>
        {text}
      </p>
    </div>
  </li>
);
