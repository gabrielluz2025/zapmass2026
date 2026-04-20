import React from 'react';
import { BarChart3, MessageCircle, Rocket, Send, Users, Zap } from 'lucide-react';
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
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 15% 20%, rgba(16,185,129,0.14) 0%, transparent 45%), radial-gradient(circle at 85% 70%, rgba(59,130,246,0.1) 0%, transparent 45%)'
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(var(--text-1) 1px, transparent 1px), linear-gradient(90deg, var(--text-1) 1px, transparent 1px)',
          backgroundSize: '48px 48px'
        }}
      />

      <div className="relative max-w-6xl mx-auto px-4 py-10 lg:py-16 lg:grid lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:items-start">
        <header className="flex items-center gap-3 mb-10 lg:mb-12">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg"
            style={{
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              boxShadow: '0 12px 40px rgba(16,185,129,0.35)'
            }}
          >
            <Zap className="w-6 h-6 text-white fill-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
              ZapMass
            </h1>
            <p className="text-[12px] font-semibold" style={{ color: 'var(--brand-600)' }}>
              Disparos em massa no WhatsApp, com organizacao
            </p>
          </div>
        </header>

        <div className="lg:col-start-1 lg:row-start-2 space-y-6 mb-10 lg:mb-0">
          <p className="text-[12px] font-bold uppercase tracking-widest" style={{ color: 'var(--brand-600)' }}>
            Plataforma
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold leading-tight max-w-xl" style={{ color: 'var(--text-1)' }}>
            Centralize chips, campanhas e contatos em um so lugar.
          </h2>
          <p className="text-[15px] leading-relaxed max-w-lg" style={{ color: 'var(--text-2)' }}>
            O ZapMass foi feito para equipes que precisam escalar comunicacao no WhatsApp com controle de ritmo, listas,
            relatorios e central de mensagens — sem perder a visao do que cada numero esta fazendo.
          </p>

          <ul className="grid sm:grid-cols-2 gap-3 pt-2">
            <Pitch icon={<Send className="w-4 h-4" />} title="Campanhas inteligentes" text="Disparos com limites, atrasos e pausa para respeitar o ritmo do WhatsApp." />
            <Pitch icon={<Users className="w-4 h-4" />} title="Base de contatos" text="Importacao, listas, etiquetas e historico para segmentar melhor." />
            <Pitch icon={<MessageCircle className="w-4 h-4" />} title="Central de chat" text="Responda conversas por chip, com contexto de campanha quando aplicavel." />
            <Pitch icon={<BarChart3 className="w-4 h-4" />} title="Relatorios" text="Acompanhe entregas, falhas e desempenho por conexao." />
          </ul>

          <div
            className="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 border"
            style={{ background: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.25)' }}
          >
            <Rocket className="w-8 h-8 flex-shrink-0 text-emerald-600" />
            <div>
              <p className="text-[14px] font-bold" style={{ color: 'var(--text-1)' }}>
                {trialTitle}
              </p>
              <p className="text-[13px] leading-snug" style={{ color: 'var(--text-2)' }}>
                {trialBody}
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-start-2 lg:row-start-2 space-y-4">
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

const Pitch: React.FC<{ icon: React.ReactNode; title: string; text: string }> = ({ icon, title, text }) => (
  <li
    className="flex gap-3 rounded-xl p-3 border"
    style={{ background: 'var(--surface-0)', borderColor: 'var(--border-subtle)' }}
  >
    <div
      className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
      style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--brand-600)' }}
    >
      {icon}
    </div>
    <div>
      <p className="text-[13px] font-bold" style={{ color: 'var(--text-1)' }}>
        {title}
      </p>
      <p className="text-[11.5px] leading-snug mt-0.5" style={{ color: 'var(--text-3)' }}>
        {text}
      </p>
    </div>
  </li>
);
