import React from 'react';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  KeyRound,
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
import {
  CHANNEL_TIER_PRICES_ANNUAL,
  CHANNEL_TIER_PRICES_MONTHLY,
  brl
} from '../constants/channelTierPricing';

const DEFAULT_PRICE_MONTHLY =
  (import.meta.env.VITE_MARKETING_PRICE_MONTHLY as string | undefined)?.trim() || 'R$ 49,90 / mês';
const DEFAULT_PRICE_ANNUAL =
  (import.meta.env.VITE_MARKETING_PRICE_ANNUAL as string | undefined)?.trim() || 'R$ 479,90 / ano';

export const PreLoginLanding: React.FC = () => {
  const { config } = useAppConfig();
  const trialTitle =
    config.landingTrialTitle.trim() ||
    `Experimente ${formatTrialHoursLabel(config.trialHours)} grátis`;
  const trialBody =
    config.landingTrialBody.trim() ||
    `Você usa todos os recursos durante ${formatTrialDurationPhrase(config.trialHours)}, sem cartão e sem cobrança automática. Ao final do teste, você escolhe o plano ideal para continuar com os envios liberados.`;

  const priceMonthly = config.marketingPriceMonthly.trim() || DEFAULT_PRICE_MONTHLY;
  const priceAnnual = config.marketingPriceAnnual.trim() || DEFAULT_PRICE_ANNUAL;
  const channelFromMonthly = `${brl(CHANNEL_TIER_PRICES_MONTHLY[1])} / mês`;
  const channelFromAnnual = `${brl(CHANNEL_TIER_PRICES_ANNUAL[1])} / ano`;

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
                Disparos em massa no WhatsApp, com organização
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="#planos"
              className="hidden sm:inline-flex text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors"
              style={{
                color: 'var(--text-2)'
              }}
            >
              Planos
            </a>
            <a
              href="#faq"
              className="hidden sm:inline-flex text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors"
              style={{
                color: 'var(--text-2)'
              }}
            >
              Dúvidas
            </a>
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
              Online agora
            </div>
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
            Operação profissional
          </div>

          <h2
            className="text-4xl sm:text-5xl font-black leading-[1.02] tracking-tight max-w-xl"
            style={{ color: 'var(--text-1)' }}
          >
            Estruture seu WhatsApp para{' '}
            <span className="text-gradient-brand">vender com consistência</span> e segurança operacional.
          </h2>

          <p className="text-[15.5px] leading-relaxed max-w-lg" style={{ color: 'var(--text-2)' }}>
            Centralize canais, campanhas, atendimento e métricas em um único painel. Do primeiro envio ao acompanhamento diário, tudo fica organizado para você escalar sem improviso.
          </p>

          {/* Stats row — social proof */}
          <div
            className="flex flex-wrap items-stretch gap-0 rounded-2xl overflow-hidden"
            style={{
              background: 'var(--surface-0)',
              border: '1px solid var(--border-subtle)',
              boxShadow: 'var(--shadow-xs)'
            }}
          >
            <StatMini value="1 a 5" label="Canais por plano" />
            <StatSep />
            <StatMini value="Pix -5%" label="Desconto imediato" />
            <StatSep />
            <StatMini value="24/7" label="Operação na nuvem" />
          </div>

          {/* Highlights */}
          <div className="flex flex-wrap gap-2 pt-1">
            <Chip
              icon={<KeyRound className="w-3.5 h-3.5" />}
              label="Gestor pelo Google ou equipe com usuário e senha"
            />
            <Chip icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Dados isolados por conta" />
            <Chip icon={<Sparkles className="w-3.5 h-3.5" />} label="Teste grátis com ativação imediata" />
          </div>

          {/* Features grid */}
          <ul className="grid sm:grid-cols-2 gap-3 pt-3">
            <Pitch
              icon={<Send className="w-4 h-4" />}
              title="Campanhas com proteção de ritmo"
              text="Limites por canal, atrasos inteligentes e pausas automáticas para reduzir risco operacional."
            />
            <Pitch
              icon={<Users className="w-4 h-4" />}
              title="Base de clientes organizada"
              text="Importe CSV, use listas e etiquetas e mantenha o histórico pronto para segmentações precisas."
            />
            <Pitch
              icon={<MessageCircle className="w-4 h-4" />}
              title="Atendimento centralizado"
              text="Responda conversas em um só lugar, com contexto de origem para acelerar o fechamento."
            />
            <Pitch
              icon={<BarChart3 className="w-4 h-4" />}
              title="Indicadores em tempo real"
              text="Acompanhe entrega, leitura, resposta e falhas por campanha e por canal."
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
          <LoginCard
            showTrialOption
            subtitle={`Responsável: entre com Google — no primeiro acesso pode ativar automaticamente o teste de ${formatTrialHoursLabel(
              config.trialHours
            )}. Funcionários: escolham «Funcionário» quando o gestor tiver criado usuário e senha em Funcionários.`}
          />
          <p className="text-[11px] text-center max-w-md mx-auto leading-snug" style={{ color: 'var(--text-3)' }}>
            Ao entrar, você concorda com o uso do ZapMass conforme as políticas do produto. O WhatsApp é operado pela
            Meta — o risco de banimento e as obrigações de LGPD são de quem dispara. Veja{' '}
            <strong>Configurações → WhatsApp / LGPD</strong> depois do login.
          </p>
        </div>

        {/* =============== PLANOS (visíveis antes do login) =============== */}
        <section id="planos" className="lg:col-span-2 mt-16 animate-fade-in-up" style={{ animationDelay: '240ms' }}>
          <div className="text-center mb-8">
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10.5px] font-bold uppercase tracking-widest mb-3"
              style={{
                background: 'var(--surface-0)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--brand-600)'
              }}
            >
              <Sparkles className="w-3 h-3" />
              Planos
            </div>
            <h3
              className="text-3xl sm:text-4xl font-black tracking-tight mb-2"
              style={{ color: 'var(--text-1)' }}
            >
              Planos por quantidade de canais
            </h3>
            <p className="text-[14px] max-w-xl mx-auto" style={{ color: 'var(--text-2)' }}>
              Você escolhe de 1 até 5 canais no checkout. Upgrade no meio do ciclo com cobrança pró-rata.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
            <PlanPreviewCard
              label="Mensal"
              price={`${channelFromMonthly} (1 canal)`}
              sub="Escala até 5 canais no checkout"
              perks={[
                'Planos: 1, 2, 3, 4 ou 5 canais',
                'Upgrade com pró-rata',
                'Cancelamento em 1 clique'
              ]}
            />
            <PlanPreviewCard
              featured
              label="Anual"
              price={`${channelFromAnnual} (1 canal)`}
              sub="Economia no ciclo anual"
              perks={[
                'Mesmas faixas de 1 a 5 canais',
                'Tudo do plano mensal',
                'Prioridade no suporte'
              ]}
            />
          </div>

          <p
            className="text-center text-[12px] mt-5"
            style={{ color: 'var(--text-3)' }}
          >
            Pagamento via <strong style={{ color: 'var(--text-2)' }}>Mercado Pago</strong> · Pix (5% off),
            cartão parcelado ou débito automático · Acesso liberado na hora da confirmação.
          </p>
        </section>

        {/* =============== COMO FUNCIONA =============== */}
        <section className="lg:col-span-2 mt-16 animate-fade-in-up" style={{ animationDelay: '300ms' }}>
          <div className="text-center mb-8">
            <h3
              className="text-3xl sm:text-4xl font-black tracking-tight mb-2"
              style={{ color: 'var(--text-1)' }}
            >
              Do primeiro login ao 1º disparo em 5 minutos
            </h3>
            <p className="text-[14px] max-w-xl mx-auto" style={{ color: 'var(--text-2)' }}>
              Sem instalação, sem servidor próprio. Abre no navegador e já começa.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <StepCard
              n={1}
              title="Conecte seu chip"
              text="Escaneie o QR Code e habilite seu primeiro canal em segundos."
            />
            <StepCard
              n={2}
              title="Cadastre seus contatos"
              text="Importe CSV, crie listas e etiquete sua base para iniciar campanhas com segmentação."
            />
            <StepCard
              n={3}
              title="Lance a campanha"
              text="Monte a mensagem, escolha os canais e acompanhe os resultados automaticamente."
            />
          </div>
        </section>

        {/* =============== FAQ =============== */}
        <section id="faq" className="lg:col-span-2 mt-16 mb-8 animate-fade-in-up" style={{ animationDelay: '360ms' }}>
          <div className="text-center mb-8">
            <h3
              className="text-3xl sm:text-4xl font-black tracking-tight mb-2"
              style={{ color: 'var(--text-1)' }}
            >
              Perguntas frequentes
            </h3>
            <p className="text-[14px]" style={{ color: 'var(--text-2)' }}>
              Tudo o que você precisa para começar sem dúvidas.
            </p>
          </div>

          <div className="max-w-3xl mx-auto space-y-2">
            <FaqItem
              q="Como o ZapMass reduz risco de bloqueio?"
              a="Aplicamos limites por canal, pausas automáticas e cadência inteligente. Isso reduz risco operacional, mas não existe garantia de zero bloqueio — boas práticas de envio continuam essenciais."
            />
            <FaqItem
              q="Com quantos canais posso começar?"
              a="Você escolhe no checkout entre 1 e 5 canais no plano mensal ou anual. Se precisar crescer depois, pode fazer upgrade com ajuste pró-rata."
            />
            <FaqItem
              q="Como funciona cancelamento e renovação?"
              a="Você gerencia tudo em 'Minha assinatura'. Pode cancelar quando quiser; o acesso segue ativo até o fim do período já pago."
            />
            <FaqItem
              q="Preciso pagar para testar?"
              a={`Não. O teste grátis de ${formatTrialHoursLabel(config.trialHours)} libera o sistema completo sem cartão. Se você não contratar depois, apenas os envios ficam bloqueados.`}
            />
            <FaqItem
              q="Meus dados e os dados dos clientes ficam seguros?"
              a="Sim. Cada conta opera com dados isolados (por gestor/responsável), autenticação segura pelo Google para o proprietário ou com usuário e senha criados dentro do ZapMass para a equipe, sempre sobre HTTPS. Você mantém controle sobre sua operação e sua base."
            />
            <FaqItem
              q="Preciso deixar computador ligado para disparar?"
              a="Não. A operação roda em nuvem 24/7. Você pode fechar o navegador e continuar acompanhando depois."
            />
          </div>
        </section>

        {/* Footer mini */}
        <footer
          className="lg:col-span-2 pt-8 pb-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11.5px]"
          style={{ color: 'var(--text-3)', borderTop: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
            >
              <Zap className="w-3.5 h-3.5 text-white fill-white" />
            </div>
            <span>© {new Date().getFullYear()} ZapMass — Disparos em massa com organização</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <Activity className="w-3 h-3" style={{ color: '#10b981' }} />
              Plataforma operando
            </span>
          </div>
        </footer>
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

const StatMini: React.FC<{ value: string; label: string }> = ({ value, label }) => (
  <div className="flex-1 min-w-[120px] px-4 py-3 text-center">
    <div
      className="text-[22px] font-black tabular-nums leading-none"
      style={{
        background: 'linear-gradient(135deg, #10b981, #059669)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text'
      }}
    >
      {value}
    </div>
    <div
      className="text-[10.5px] font-semibold uppercase tracking-wider mt-1"
      style={{ color: 'var(--text-3)' }}
    >
      {label}
    </div>
  </div>
);

const StatSep: React.FC = () => (
  <div className="w-px self-stretch my-3" style={{ background: 'var(--border-subtle)' }} />
);

const PlanPreviewCard: React.FC<{
  label: string;
  price: string;
  sub: string;
  perks: string[];
  featured?: boolean;
}> = ({ label, price, sub, perks, featured }) => (
  <div
    className="relative rounded-2xl p-5"
    style={
      featured
        ? {
            background:
              'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(59,130,246,0.06))',
            border: '1.5px solid rgba(16,185,129,0.4)',
            boxShadow: '0 12px 40px rgba(16,185,129,0.15)'
          }
        : {
            background: 'var(--surface-0)',
            border: '1px solid var(--border)'
          }
    }
  >
    {featured && (
      <span
        className="absolute -top-2.5 left-5 text-[9.5px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full"
        style={{
          background: 'linear-gradient(135deg, #10b981, #059669)',
          color: '#fff',
          boxShadow: '0 4px 14px rgba(16,185,129,0.4)'
        }}
      >
        Mais escolhido
      </span>
    )}

    <p
      className="text-[11px] font-bold uppercase tracking-widest mb-1"
      style={{ color: featured ? 'var(--brand-600)' : 'var(--text-3)' }}
    >
      {label}
    </p>
    <p
      className="text-[28px] font-black leading-tight"
      style={{ color: 'var(--text-1)' }}
    >
      {price}
    </p>
    <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>
      {sub}
    </p>

    <ul className="mt-4 space-y-1.5">
      {perks.map((p) => (
        <li key={p} className="flex items-start gap-2 text-[12.5px]" style={{ color: 'var(--text-2)' }}>
          <CheckCircle2
            className="w-4 h-4 shrink-0 mt-0.5"
            style={{ color: 'var(--brand-600)' }}
          />
          <span>{p}</span>
        </li>
      ))}
    </ul>
  </div>
);

const StepCard: React.FC<{ n: number; title: string; text: string }> = ({ n, title, text }) => (
  <div
    className="rounded-2xl p-5 relative overflow-hidden"
    style={{
      background: 'var(--surface-0)',
      border: '1px solid var(--border-subtle)'
    }}
  >
    <div
      className="absolute -top-6 -right-6 text-[100px] font-black leading-none pointer-events-none select-none"
      style={{
        color: 'var(--surface-2)',
        opacity: 0.5
      }}
    >
      {n}
    </div>
    <div className="relative">
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center mb-3 text-[13px] font-extrabold"
        style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(16,185,129,0.08))',
          color: 'var(--brand-600)',
          border: '1px solid rgba(16,185,129,0.3)'
        }}
      >
        {n}
      </div>
      <p className="text-[14px] font-extrabold mb-1" style={{ color: 'var(--text-1)' }}>
        {title}
      </p>
      <p className="text-[12.5px] leading-snug" style={{ color: 'var(--text-3)' }}>
        {text}
      </p>
    </div>
  </div>
);

const FaqItem: React.FC<{ q: string; a: string }> = ({ q, a }) => (
  <details
    className="group rounded-xl overflow-hidden transition-colors"
    style={{
      background: 'var(--surface-0)',
      border: '1px solid var(--border-subtle)'
    }}
  >
    <summary
      className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none select-none"
      style={{ color: 'var(--text-1)' }}
    >
      <span className="text-[13.5px] font-bold">{q}</span>
      <ChevronDown
        className="w-4 h-4 shrink-0 transition-transform group-open:rotate-180"
        style={{ color: 'var(--text-3)' }}
      />
    </summary>
    <div
      className="px-4 pb-4 text-[13px] leading-relaxed"
      style={{ color: 'var(--text-2)' }}
    >
      {a}
    </div>
  </details>
);
