import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Database,
  LogIn,
  Lock,
  MessageCircle,
  Send,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  X,
  Zap
} from 'lucide-react';
import { LoginCard, loginCardDefaultCopy } from './auth/LoginCard';
import { useLandingDocumentMeta } from '../hooks/useLandingDocumentMeta';
import { useAppConfig } from '../context/AppConfigContext';
import { resolveLandingTrialCopy } from '../utils/landingTrialResolved';
import { trackLandingEvent } from '../utils/marketingEvents';
import { formatTrialHoursLabel } from '../utils/trialCopy';
import {
  WHATSAPP_META_CLOUD_OVERVIEW,
  WHATSAPP_META_POLICY,
  WHATSAPP_RISK_BULLETS,
  WHATSAPP_RISK_SHORT
} from '../constants/whatsappLegal';
import {
  CHANNEL_TIER_PRICES_ANNUAL,
  CHANNEL_TIER_PRICES_MONTHLY,
  brl
} from '../constants/channelTierPricing';
import {
  computeAnnualSavingsPercent,
  fetchServerBillingPrices,
  roundMoneyBRL,
  type ServerBillingPrices
} from '../utils/marketingPrices';

export const PreLoginLanding: React.FC = () => {
  useLandingDocumentMeta();
  const { config } = useAppConfig();
  const { title: trialTitle, body: trialBody } = resolveLandingTrialCopy(config);
  const trialLabel = formatTrialHoursLabel(config.trialHours);

  const [authOpen, setAuthOpen] = useState(false);

  /** Abre o modal de autenticação e dispara o evento de marketing. */
  const openAuth = React.useCallback((ctaId: string) => {
    trackLandingEvent('landing_cta_click', { cta_id: ctaId });
    setAuthOpen(true);
  }, []);

  useEffect(() => {
    const FAQ_WHATSAPP_ID = 'faq-whatsapp-lgpd';
    const openIfHash = () => {
      if (typeof window === 'undefined' || window.location.hash !== `#${FAQ_WHATSAPP_ID}`) return;
      const el = document.getElementById(FAQ_WHATSAPP_ID);
      if (el instanceof HTMLDetailsElement) el.open = true;
    };
    openIfHash();
    window.addEventListener('hashchange', openIfHash);
    return () => window.removeEventListener('hashchange', openIfHash);
  }, []);

  // Bloqueia scroll do body + ESC fecha enquanto o modal de acesso está aberto
  useEffect(() => {
    if (!authOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAuthOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [authOpen]);

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
            'radial-gradient(circle at 30% 30%, rgba(16,185,129,0.32), rgba(16,185,129,0) 60%)',
          filter: 'blur(40px)'
        }}
      />
      <div
        aria-hidden
        className="absolute top-[8%] right-[-200px] w-[600px] h-[600px] rounded-full pointer-events-none animate-blob-slow"
        style={{
          background:
            'radial-gradient(circle at 60% 40%, rgba(59,130,246,0.26), rgba(59,130,246,0) 60%)',
          filter: 'blur(55px)'
        }}
      />
      <div
        aria-hidden
        className="absolute bottom-[-200px] left-[15%] w-[640px] h-[640px] rounded-full pointer-events-none animate-blob"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(34,211,238,0.16), rgba(34,211,238,0) 60%)',
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
          maskImage: 'radial-gradient(ellipse at 50% 18%, #000 38%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 18%, #000 38%, transparent 78%)'
        }}
      />

      {/* Header sticky com glass */}
      <header
        className="sticky top-0 z-30 backdrop-blur-md border-b animate-fade-in-up"
        style={{
          background: 'color-mix(in srgb, var(--bg) 80%, transparent)',
          borderColor: 'var(--border-subtle)'
        }}
      >
        <div className="max-w-[1200px] mx-auto flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 md:px-8 py-3 sm:py-3.5">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                boxShadow: '0 6px 20px rgba(16,185,129,0.35)'
              }}
            >
              <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-white fill-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[15px] sm:text-base font-extrabold tracking-tight truncate" style={{ color: 'var(--text-1)' }}>
                ZapMass
              </p>
              <p className="text-[10px] sm:text-[11px] font-semibold leading-tight" style={{ color: 'var(--brand-600)' }}>
                Disparos com cabeça
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-1 sm:gap-1.5">
            <a
              href="#planos"
              onClick={() => trackLandingEvent('landing_cta_click', { cta_id: 'header_planos' })}
              className="hidden sm:inline-flex text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors hover:bg-black/[0.04]"
              style={{ color: 'var(--text-2)' }}
            >
              Planos
            </a>
            <a
              href="#como-funciona"
              onClick={() => trackLandingEvent('landing_cta_click', { cta_id: 'header_como' })}
              className="hidden md:inline-flex text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors hover:bg-black/[0.04]"
              style={{ color: 'var(--text-2)' }}
            >
              Como funciona
            </a>
            <a
              href="#faq"
              onClick={() => trackLandingEvent('landing_cta_click', { cta_id: 'header_faq' })}
              className="hidden sm:inline-flex text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors hover:bg-black/[0.04]"
              style={{ color: 'var(--text-2)' }}
            >
              Dúvidas
            </a>
            <button
              type="button"
              onClick={() => openAuth('header_signin')}
              className="inline-flex items-center px-3 sm:px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-colors hover:bg-black/[0.04]"
              style={{ color: 'var(--text-1)', border: '1px solid var(--border-subtle)' }}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => openAuth('header_signup')}
              className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-full text-[12px] font-bold text-white transition-all hover:brightness-110 hover:scale-[1.02] active:scale-[0.98] whitespace-nowrap"
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                boxShadow: '0 6px 16px rgba(16,185,129,0.3)'
              }}
            >
              Inscrever-se
              <ArrowRight className="w-3 h-3 opacity-90 shrink-0" />
            </button>
          </nav>
        </div>
      </header>

      <div className="relative w-full max-w-[1200px] mx-auto px-4 sm:px-6 md:px-8 pt-8 sm:pt-10 md:pt-14 lg:pt-16 pb-6 sm:pb-8">
        {/* HERO */}
        <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-8 md:gap-10 lg:gap-x-12 lg:items-start">
          {/* Coluna esquerda — narrativa */}
          <div className="space-y-6 md:space-y-7 animate-fade-in-up" style={{ animationDelay: '60ms' }}>
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10.5px] font-bold uppercase tracking-[0.16em] badge-shimmer"
              style={{
                color: 'var(--brand-600)',
                border: '1px solid rgba(16,185,129,0.28)'
              }}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full pulse-dot" style={{ background: '#10b981' }} />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: '#10b981' }} />
              </span>
              Novo · Operação profissional
            </div>

            <h2
              className="font-black tracking-tight leading-[1.04] text-[2rem] sm:text-[2.4rem] md:text-[2.7rem] lg:text-[3rem] xl:text-[3.25rem]"
              style={{ color: 'var(--text-1)' }}
            >
              Disparos no WhatsApp{' '}
              <span className="text-gradient-brand">organizados</span>
              <br className="hidden sm:block" />
              {' '}para vender com consistência.
            </h2>

            <p className="text-[14.5px] sm:text-[15.5px] leading-relaxed max-w-xl md:max-w-[42rem]" style={{ color: 'var(--text-2)' }}>
              Um painel para campanhas, base de contatos, atendimento e métricas — sem improviso na operação.
              Comece grátis em segundos: <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{trialLabel}</span>, sem cartão.
            </p>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <button
                type="button"
                onClick={() => openAuth('hero_primary')}
                className="group inline-flex items-center justify-center gap-2 px-5 sm:px-6 py-3 sm:py-3.5 rounded-2xl text-[13.5px] sm:text-[14.5px] font-bold text-white transition-all hover:brightness-110 hover:scale-[1.02] active:scale-[0.98] w-full sm:w-auto min-h-[48px]"
                style={{
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%)',
                  boxShadow: '0 16px 36px rgba(16,185,129,0.38)'
                }}
              >
                Começar grátis agora
                <ArrowRight className="w-4 h-4 opacity-95 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </button>
              <a
                href="#planos"
                onClick={() => trackLandingEvent('landing_cta_click', { cta_id: 'hero_view_plans' })}
                className="inline-flex items-center justify-center px-5 py-3 rounded-2xl text-[13px] font-semibold transition-colors hover:bg-black/[0.03] w-full sm:w-auto min-h-[48px] border"
                style={{
                  color: 'var(--text-2)',
                  borderColor: 'var(--border-subtle)',
                  background: 'var(--surface-0)'
                }}
              >
                Ver planos e valores
              </a>
            </div>

            {/* Trust strip horizontal — substitui o cartão grande de teste */}
            <div className="flex flex-wrap items-stretch gap-2 sm:gap-3 max-w-2xl">
              <TrustChip icon={<Sparkles className="w-3.5 h-3.5" />} label={trialLabel} hint="grátis · sem cartão" tone="emerald" />
              <TrustChip icon={<Activity className="w-3.5 h-3.5" />} label="24/7 na nuvem" hint="sem PC ligado" tone="cyan" />
              <TrustChip icon={<Database className="w-3.5 h-3.5" />} label="Pix −5%" hint="no pagamento" tone="emerald" />
              <TrustChip icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Dados isolados" hint="por conta" tone="blue" />
            </div>

            {/* Pilares — sem caixa volumosa, só ícones inline */}
            <div className="pt-2">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] mb-3" style={{ color: 'var(--text-3)' }}>
                O que o painel entrega
              </p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <BenefitTile
                  icon={<Send className="w-3.5 h-3.5" />}
                  title="Campanhas com ritmo seguro"
                  text="Limites por canal, pausas e cadência."
                />
                <BenefitTile
                  icon={<Users className="w-3.5 h-3.5" />}
                  title="Base organizada"
                  text="CSV, listas e etiquetas para segmentar."
                />
                <BenefitTile
                  icon={<MessageCircle className="w-3.5 h-3.5" />}
                  title="Atendimento centralizado"
                  text="Conversas no mesmo lugar, com contexto."
                />
                <BenefitTile
                  icon={<BarChart3 className="w-3.5 h-3.5" />}
                  title="Indicadores na hora"
                  text="Entrega e resposta por campanha e canal."
                />
              </ul>
            </div>
          </div>

          {/* Coluna direita — cartão compacto de acesso (abre modal) */}
          <div
            className="w-full max-w-[360px] mx-auto lg:max-w-none lg:mx-0 animate-fade-in-up lg:sticky lg:top-24 lg:self-start"
            style={{ animationDelay: '160ms' }}
          >
            <div
              className="relative overflow-hidden rounded-2xl p-4 sm:p-5"
              style={{
                background: 'var(--surface-0)',
                border: '1px solid var(--border)',
                boxShadow: '0 12px 32px rgba(0,0,0,0.14)'
              }}
            >
              <div
                className="h-[2px] -mx-4 sm:-mx-5 -mt-4 sm:-mt-5 mb-4 bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500 opacity-[0.92]"
                aria-hidden
              />

              <div className="flex items-center justify-between mb-3">
                <p className="text-[9.5px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--text-3)' }}>
                  Acesso ao painel
                </p>
                <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold" style={{ color: 'var(--brand-600)' }}>
                  <Lock className="w-2.5 h-2.5" /> Seguro
                </span>
              </div>

              <h3 className="text-[1.05rem] font-extrabold leading-tight tracking-tight" style={{ color: 'var(--text-1)' }}>
                Entre ou crie sua conta
              </h3>
              <p className="mt-1 mb-3.5 text-[12px] leading-snug" style={{ color: 'var(--text-3)' }}>
                Google, Apple, Facebook ou e-mail. {trialLabel} grátis no primeiro acesso, sem cartão.
              </p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openAuth('access_card_signin')}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[12.5px] font-bold text-white transition-all hover:brightness-110 active:scale-[0.98]"
                  style={{
                    background: 'linear-gradient(135deg, #111827 0%, #0a0f1a 100%)',
                    boxShadow: '0 6px 16px rgba(0,0,0,0.25)'
                  }}
                >
                  <LogIn className="h-3.5 w-3.5" />
                  Entrar
                </button>
                <button
                  type="button"
                  onClick={() => openAuth('access_card_signup')}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[12.5px] font-semibold transition-colors hover:bg-black/[0.04]"
                  style={{
                    color: 'var(--text-1)',
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <UserPlus className="h-3.5 w-3.5" style={{ color: 'var(--brand-600)' }} />
                  Inscrever-se
                </button>
              </div>

              <div
                className="mt-3 rounded-lg px-2.5 py-1.5 text-[10.5px] leading-snug flex items-start gap-2"
                style={{
                  background: 'rgba(16,185,129,0.06)',
                  border: '1px solid rgba(16,185,129,0.14)',
                  color: 'var(--text-2)'
                }}
              >
                <Sparkles className="w-3 h-3 shrink-0 mt-0.5" style={{ color: 'var(--brand-600)' }} />
                <span>
                  Funcionário com login criado pelo gestor? Use também o botão <strong>Entrar</strong>.
                </span>
              </div>
            </div>

            <p className="mt-2 text-[10px] text-center lg:text-left leading-snug px-0.5" style={{ color: 'var(--text-3)' }}>
              Ao continuar você aceita as políticas do ZapMass.{' '}
              <a
                href="#faq-whatsapp-lgpd"
                className="font-semibold underline underline-offset-2 hover:opacity-90"
                style={{ color: 'var(--brand-600)' }}
              >
                WhatsApp e LGPD
              </a>
              .
            </p>
          </div>
        </section>

        {/* TESTE / DESTAQUE EM TEXT BLOCK SUTIL */}
        <section className="mt-14 sm:mt-16 md:mt-20 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
          <div
            className="relative overflow-hidden rounded-3xl p-6 sm:p-8 md:p-10 border max-w-5xl mx-auto"
            style={{
              background: 'linear-gradient(135deg, rgba(16,185,129,0.06) 0%, var(--surface-0) 50%, rgba(59,130,246,0.05) 100%)',
              borderColor: 'var(--border-subtle)',
              boxShadow: '0 12px 50px rgba(0,0,0,0.07)'
            }}
          >
            <div
              aria-hidden
              className="absolute -top-16 -right-16 w-72 h-72 rounded-full pointer-events-none"
              style={{
                background: 'radial-gradient(circle at 50% 50%, rgba(16,185,129,0.25), transparent 70%)',
                filter: 'blur(30px)'
              }}
            />
            <div className="relative grid md:grid-cols-[1.1fr_0.9fr] gap-6 items-center">
              <div>
                <h3 className="text-2xl sm:text-3xl md:text-[2rem] font-black tracking-tight leading-tight" style={{ color: 'var(--text-1)' }}>
                  {trialTitle}
                </h3>
                <p className="text-[13.5px] sm:text-[14.5px] mt-2 leading-relaxed max-w-xl" style={{ color: 'var(--text-2)' }}>
                  {trialBody}
                </p>
              </div>
              <ul className="space-y-2.5 text-[13px] leading-snug md:pl-6 md:border-l" style={{ color: 'var(--text-2)', borderColor: 'var(--border-subtle)' }}>
                <li className="flex gap-2.5 items-start">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden />
                  <span>
                    <strong style={{ color: 'var(--text-1)' }}>Gestor</strong> entra com Google, Apple, Facebook ou e-mail.
                  </span>
                </li>
                <li className="flex gap-2.5 items-start">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden />
                  <span>
                    <strong style={{ color: 'var(--text-1)' }}>Equipe</strong> com usuários criados por você no painel.
                  </span>
                </li>
                <li className="flex gap-2.5 items-start">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden />
                  <span>Operação 24/7, dados isolados por conta.</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* PLANOS */}
        <section id="planos" className="mt-14 sm:mt-16 md:mt-20 scroll-mt-24 animate-fade-in-up" style={{ animationDelay: '260ms' }}>
          <LandingPlanCards onPickPlan={(id) => openAuth(id)} />

          <div
            className="max-w-3xl mx-auto mt-8 rounded-2xl border px-4 py-4 sm:px-6"
            style={{
              background: 'var(--surface-0)',
              borderColor: 'var(--border-subtle)'
            }}
          >
            <p className="text-[13px] font-bold mb-3" style={{ color: 'var(--text-1)' }}>
              Em todos os planos
            </p>
            <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-[12.5px]" style={{ color: 'var(--text-2)' }}>
              <li className="flex gap-2 items-start">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden />
                Pagamento via Mercado Pago (Pix com 5% off, cartão parcelado ou débito)
              </li>
              <li className="flex gap-2 items-start">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden />
                Cancelamento em poucos cliques em «Minha assinatura»
              </li>
              <li className="flex gap-2 items-start">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden />
                Acesso liberado na hora após confirmação do pagamento
              </li>
              <li className="flex gap-2 items-start">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden />
                Plano anual inclui prioridade no suporte
              </li>
            </ul>
          </div>

          <p className="text-center text-[12px] mt-6 max-w-2xl mx-auto" style={{ color: 'var(--text-3)' }}>
            Os valores são carregados do servidor ao abrir a página — os mesmos do checkout Mercado Pago.
            Sem taxas escondidas no produto; condições do Mercado Pago valem para o método de pagamento escolhido.
          </p>
        </section>

        {/* COMO FUNCIONA — timeline */}
        <section id="como-funciona" className="mt-14 sm:mt-16 md:mt-20 scroll-mt-24 animate-fade-in-up" style={{ animationDelay: '320ms' }}>
          <div className="text-center mb-8 sm:mb-10 px-1">
            <h3 className="text-2xl sm:text-3xl md:text-[2.2rem] font-black tracking-tight mb-2" style={{ color: 'var(--text-1)' }}>
              Do primeiro login ao 1º disparo em 5 minutos
            </h3>
            <p className="text-[13px] sm:text-[14px] max-w-xl mx-auto" style={{ color: 'var(--text-2)' }}>
              Sem instalação, sem servidor próprio. Abre no navegador e já começa.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:timeline-line">
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

        {/* FAQ */}
        <section id="faq" className="mt-14 sm:mt-16 md:mt-20 mb-8 animate-fade-in-up scroll-mt-24" style={{ animationDelay: '380ms' }}>
          <div className="text-center mb-6 sm:mb-8 px-1">
            <h3 className="text-2xl sm:text-3xl md:text-[2.2rem] font-black tracking-tight mb-2" style={{ color: 'var(--text-1)' }}>
              Perguntas frequentes
            </h3>
            <p className="text-[13px] sm:text-[14px]" style={{ color: 'var(--text-2)' }}>
              Tudo o que você precisa para começar sem dúvidas.
            </p>
          </div>

          <div className="max-w-3xl mx-auto space-y-2.5">
            <FaqItem
              q="Como o ZapMass reduz risco de bloqueio?"
              a="Aplicamos limites por canal, pausas automáticas e cadência inteligente. Isso reduz risco operacional, mas não existe garantia de zero bloqueio — boas práticas de envio continuam essenciais."
            />
            <FaqItem
              id="faq-whatsapp-lgpd"
              q="WhatsApp (Meta), LGPD e API oficial — qual é minha responsabilidade?"
              a={
                <>
                  <p className="mb-3">{WHATSAPP_RISK_SHORT}</p>
                  <ul className="list-disc pl-4 space-y-1.5 mb-3">
                    {WHATSAPP_RISK_BULLETS.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                  <p className="text-[12.5px] mb-2" style={{ color: 'var(--text-3)' }}>
                    Documentação oficial da Meta:{' '}
                    <a
                      href={WHATSAPP_META_POLICY}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold hover:underline"
                      style={{ color: 'var(--brand-600)' }}
                    >
                      Políticas do WhatsApp para empresas
                    </a>
                    {' · '}
                    <a
                      href={WHATSAPP_META_CLOUD_OVERVIEW}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold hover:underline"
                      style={{ color: 'var(--brand-600)' }}
                    >
                      Visão geral da API (Cloud)
                    </a>
                    .
                  </p>
                  <p className="text-[12.5px]" style={{ color: 'var(--text-3)' }}>
                    No painel: <strong className="font-semibold" style={{ color: 'var(--text-2)' }}>Configurações → WhatsApp / LGPD</strong> para referência interna do produto.
                  </p>
                </>
              }
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
              a={`Não. O teste grátis de ${trialLabel} libera o sistema completo sem cartão. Se você não contratar depois, apenas os envios ficam bloqueados.`}
            />
            <FaqItem
              q="Meus dados e os dados dos clientes ficam seguros?"
              a="Sim. Cada conta opera com dados isolados (por gestor/responsável), autenticação segura com Google, Apple ou Facebook para o proprietário ou com usuário e senha criados dentro do ZapMass para a equipe, sempre sobre HTTPS. Você mantém controle sobre sua operação e sua base."
            />
            <FaqItem
              q="Preciso deixar computador ligado para disparar?"
              a="Não. A operação roda em nuvem 24/7. Você pode fechar o navegador e continuar acompanhando depois."
            />
          </div>
        </section>

        {/* CTA FINAL */}
        <section className="mt-12 sm:mt-14 md:mt-16 animate-fade-in-up" style={{ animationDelay: '420ms' }}>
          <div
            className="relative overflow-hidden rounded-3xl p-6 sm:p-8 md:p-10 text-center max-w-4xl mx-auto"
            style={{
              background: 'linear-gradient(135deg, #047857 0%, #059669 50%, #10b981 100%)',
              boxShadow: '0 20px 60px rgba(16,185,129,0.35)'
            }}
          >
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none opacity-30"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.25), transparent 50%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.18), transparent 55%)'
              }}
            />
            <div className="relative">
              <h3 className="text-2xl sm:text-3xl md:text-[2rem] font-black tracking-tight text-white mb-2 leading-tight">
                Pronto para sair do improviso?
              </h3>
              <p className="text-[14px] sm:text-[15px] text-white/85 max-w-xl mx-auto mb-5 sm:mb-6">
                Crie sua conta agora. {trialLabel} grátis, sem cartão, com tudo liberado.
              </p>
              <button
                type="button"
                onClick={() => openAuth('final_cta')}
                className="inline-flex items-center gap-2 px-6 sm:px-7 py-3 sm:py-3.5 rounded-2xl text-[14px] sm:text-[14.5px] font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: '#ffffff',
                  color: '#047857',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.18)'
                }}
              >
                Começar grátis
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>
            </div>
          </div>
        </section>

        {/* Footer mini */}
        <footer
          className="pt-8 pb-6 mt-10 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11.5px] text-center sm:text-left"
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

      {/* Modal de autenticação (abre via botões «Entrar» / «Inscrever-se») */}
      {authOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Acesso ao painel"
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center px-3 py-6 sm:p-6 overflow-y-auto"
        >
          <div
            aria-hidden
            onClick={() => setAuthOpen(false)}
            className="absolute inset-0 bg-black/65 backdrop-blur-sm animate-fade-in-up"
            style={{ animationDuration: '160ms' }}
          />
          <div
            className="relative z-10 w-full max-w-[420px] animate-fade-in-up"
            style={{ animationDuration: '220ms' }}
          >
            <button
              type="button"
              onClick={() => setAuthOpen(false)}
              aria-label="Fechar"
              className="absolute -top-3 -right-3 z-20 w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              style={{
                background: 'var(--surface-0)',
                border: '1px solid var(--border)',
                color: 'var(--text-1)',
                boxShadow: '0 6px 18px rgba(0,0,0,0.22)'
              }}
            >
              <X className="w-4 h-4" />
            </button>
            <LoginCard landingLayout showTrialOption title={loginCardDefaultCopy.title} subtitle={loginCardDefaultCopy.subtitle} />
            <p className="mt-2 text-[10px] text-center leading-snug px-1" style={{ color: 'rgba(255,255,255,0.78)' }}>
              Ao continuar você aceita as políticas do ZapMass ·{' '}
              <a
                href="#faq-whatsapp-lgpd"
                onClick={() => setAuthOpen(false)}
                className="font-semibold underline underline-offset-2 hover:opacity-90"
                style={{ color: '#a7f3d0' }}
              >
                WhatsApp e LGPD
              </a>
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const CHANNEL_TIERS = [1, 2, 3, 4, 5] as const;

const TrustChip: React.FC<{
  icon: React.ReactNode;
  label: string;
  hint: string;
  tone: 'emerald' | 'blue' | 'cyan';
}> = ({ icon, label, hint, tone }) => {
  const palette =
    tone === 'emerald'
      ? { iconBg: 'rgba(16,185,129,0.16)', iconColor: '#059669' }
      : tone === 'cyan'
        ? { iconBg: 'rgba(34,211,238,0.18)', iconColor: '#0891b2' }
        : { iconBg: 'rgba(59,130,246,0.18)', iconColor: '#2563eb' };
  return (
    <div
      className="flex items-center gap-2.5 rounded-2xl px-3 py-2 sm:px-3.5 sm:py-2.5 border flex-1 min-w-[140px] sm:min-w-[150px] sm:flex-none transition-shadow hover:shadow-sm"
      style={{
        background: 'var(--surface-0)',
        borderColor: 'var(--border-subtle)'
      }}
    >
      <div
        className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: palette.iconBg, color: palette.iconColor }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[12.5px] sm:text-[13px] font-bold leading-tight tracking-tight" style={{ color: 'var(--text-1)' }}>
          {label}
        </p>
        <p className="text-[10px] sm:text-[10.5px] leading-snug" style={{ color: 'var(--text-3)' }}>
          {hint}
        </p>
      </div>
    </div>
  );
};

function tierMoney(n: (typeof CHANNEL_TIERS)[number], server: ServerBillingPrices | null): { monthly: number; annual: number } {
  const row = server?.channelTiers?.[String(n)];
  return {
    monthly: row?.monthly ?? CHANNEL_TIER_PRICES_MONTHLY[n],
    annual: row?.annual ?? CHANNEL_TIER_PRICES_ANNUAL[n]
  };
}

function maxAnnualSavingsPct(server: ServerBillingPrices | null): number | null {
  let best: number | null = null;
  for (const n of CHANNEL_TIERS) {
    const { monthly, annual } = tierMoney(n, server);
    const p = computeAnnualSavingsPercent(monthly, annual);
    if (p != null && (best === null || p > best)) best = p;
  }
  return best;
}

/** Secção de planos estilo cartões (landing pré-login), preços do servidor quando disponível. */
const LandingPlanCards: React.FC<{ onPickPlan: (ctaId: string) => void }> = ({ onPickPlan }) => {
  const [server, setServer] = useState<ServerBillingPrices | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'done'>('loading');
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');

  useEffect(() => {
    let alive = true;
    fetchServerBillingPrices()
      .then((p) => {
        if (alive) setServer(p);
      })
      .finally(() => {
        if (alive) setLoadState('done');
      });
    return () => {
      alive = false;
    };
  }, []);

  const pixPct = Math.round((server?.pixDiscountPct ?? 0.05) * 100);
  const fromCheckout = server?.channelTiers != null;
  const savingsPct = maxAnnualSavingsPct(server);

  return (
    <div className="max-w-[1200px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5 md:gap-6 mb-6 sm:mb-8 lg:mb-10 px-0.5 sm:px-0">
        <div className="max-w-xl">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] mb-2" style={{ color: 'var(--brand-600)' }}>
            Planos
          </p>
          <h3 className="text-2xl sm:text-3xl md:text-[2.2rem] font-black tracking-tight leading-tight" style={{ color: 'var(--text-1)' }}>
            Escolha seu plano
          </h3>
          <p className="text-[14px] sm:text-[15px] mt-2 leading-relaxed" style={{ color: 'var(--text-3)' }}>
            Quanto mais canais, menor o custo por canal.{' '}
            <span style={{ color: 'var(--text-2)' }}>Valores iguais ao checkout Mercado Pago.</span>
          </p>
        </div>

        <div
          className="inline-flex items-center gap-1 p-1 rounded-full shrink-0 self-start md:self-end border"
          style={{
            background: 'var(--surface-1)',
            borderColor: 'var(--border-subtle)'
          }}
          role="group"
          aria-label="Período de cobrança"
        >
          <button
            type="button"
            onClick={() => {
              setCycle('monthly');
              trackLandingEvent('landing_plan_cycle', { cycle: 'monthly' });
            }}
            className="px-4 py-2 rounded-full text-[12.5px] font-bold transition-all min-w-[5.5rem]"
            style={{
              background: cycle === 'monthly' ? 'var(--surface-2)' : 'transparent',
              color: cycle === 'monthly' ? 'var(--text-1)' : 'var(--text-3)',
              boxShadow: cycle === 'monthly' ? '0 1px 8px rgba(0,0,0,0.12)' : undefined
            }}
            aria-pressed={cycle === 'monthly'}
          >
            Mensal
          </button>
          <button
            type="button"
            onClick={() => {
              setCycle('annual');
              trackLandingEvent('landing_plan_cycle', { cycle: 'annual' });
            }}
            className="px-4 py-2 rounded-full text-[12.5px] font-bold transition-all flex flex-wrap items-center justify-center gap-2 sm:min-w-[8rem]"
            style={{
              background: cycle === 'annual' ? 'var(--surface-2)' : 'transparent',
              color: cycle === 'annual' ? 'var(--text-1)' : 'var(--text-3)',
              boxShadow: cycle === 'annual' ? '0 1px 8px rgba(0,0,0,0.12)' : undefined
            }}
            aria-pressed={cycle === 'annual'}
          >
            Anual
            {savingsPct != null ? (
              <span
                className="text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full text-white"
                style={{
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                }}
              >
                Economize {savingsPct}%
              </span>
            ) : null}
          </button>
        </div>
      </div>

      <div className="flex lg:grid lg:grid-cols-5 gap-3 sm:gap-4 overflow-x-auto pb-4 lg:pb-0 snap-x snap-mandatory lg:snap-none -mx-1 px-1 sm:-mx-0 sm:px-0 [scrollbar-width:thin] [touch-pan-x]">
        {loadState === 'loading'
          ? CHANNEL_TIERS.map((n) => (
              <div
                key={n}
                className="min-w-[min(280px,calc(100vw-2.5rem))] sm:min-w-[260px] lg:min-w-0 snap-center shrink-0 rounded-2xl h-[320px] animate-pulse border"
                style={{
                  background: 'var(--surface-1)',
                  borderColor: 'var(--border-subtle)'
                }}
                aria-hidden
              />
            ))
          : CHANNEL_TIERS.map((n) => {
              const { monthly, annual } = tierMoney(n, server);
              const total = cycle === 'monthly' ? monthly : annual;
              const perChannel = roundMoneyBRL(total / n);
              const equivMonthly = cycle === 'annual' ? roundMoneyBRL(annual / 12) : null;

              const highlightStarter = n === 2;
              const highlightPopular = n === 3;
              const isHighlighted = highlightPopular || highlightStarter;

              return (
                <article
                  key={n}
                  className={`relative min-w-[min(280px,calc(100vw-2.5rem))] sm:min-w-[260px] lg:min-w-0 snap-center shrink-0 rounded-2xl p-5 flex flex-col border transition-all hover:-translate-y-0.5 hover:shadow-xl ${
                    highlightPopular ? 'plan-halo-emerald' : ''
                  }`}
                  style={{
                    background: isHighlighted
                      ? 'linear-gradient(180deg, var(--surface-0) 0%, color-mix(in srgb, var(--surface-1) 80%, transparent) 100%)'
                      : 'var(--surface-0)',
                    borderColor: highlightPopular
                      ? 'rgba(16,185,129,0.45)'
                      : highlightStarter
                        ? 'rgba(59,130,246,0.45)'
                        : 'var(--border-subtle)',
                    boxShadow: isHighlighted ? '0 14px 44px rgba(0,0,0,0.18)' : 'var(--shadow-sm)'
                  }}
                >
                  {highlightStarter ? (
                    <span
                      className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[9.5px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full whitespace-nowrap text-white"
                      style={{
                        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                        boxShadow: '0 6px 16px rgba(37,99,235,0.35)'
                      }}
                    >
                      Indicado
                    </span>
                  ) : null}
                  {highlightPopular ? (
                    <span
                      className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[9.5px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full whitespace-nowrap text-white"
                      style={{
                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                        boxShadow: '0 6px 16px rgba(16,185,129,0.4)'
                      }}
                    >
                      Mais popular
                    </span>
                  ) : null}

                  <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] mb-3 mt-1" style={{ color: 'var(--text-3)' }}>
                    {n === 1 ? '1 canal' : `${n} canais`}
                  </p>

                  <div className="mb-1 flex items-baseline gap-1.5">
                    <span className="text-[1.75rem] sm:text-[2rem] font-black tabular-nums tracking-tight leading-none" style={{ color: 'var(--text-1)' }}>
                      {brl(total)}
                    </span>
                    <span className="text-[12px] font-medium" style={{ color: 'var(--text-3)' }}>
                      {cycle === 'monthly' ? '/mês' : '/ano'}
                    </span>
                  </div>
                  {equivMonthly != null ? (
                    <p className="text-[11.5px] mb-4 min-h-[2.25rem]" style={{ color: 'var(--brand-600)' }}>
                      ≈ {brl(equivMonthly)}/mês em média
                    </p>
                  ) : (
                    <p className="text-[11.5px] mb-4 min-h-[2.25rem]" style={{ color: 'var(--text-3)' }}>
                      Renove ou cancele quando quiser
                    </p>
                  )}

                  <ul className="space-y-2.5 flex-1 text-[12.5px]" style={{ color: 'var(--text-2)' }}>
                    <li className="flex gap-2 items-start">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden />
                      <span>
                        <strong style={{ color: 'var(--text-1)' }}>{brl(perChannel)}</strong>{' '}
                        {cycle === 'monthly' ? 'por canal/mês' : 'por canal/ano'}
                      </span>
                    </li>
                    <li className="flex gap-2 items-start">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden />
                      Campanhas e base organizadas
                    </li>
                    {n >= 2 ? (
                      <li className="flex gap-2 items-start">
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden />
                        Multi-WhatsApp ({n} números)
                      </li>
                    ) : null}
                  </ul>

                  <button
                    type="button"
                    onClick={() => onPickPlan(`plan_card_${n}_${cycle}`)}
                    className={`mt-5 inline-flex justify-center items-center w-full py-2.5 rounded-xl text-[12.5px] font-bold transition-all hover:brightness-110 active:scale-[0.98] ${
                      isHighlighted ? 'text-white' : ''
                    }`}
                    style={{
                      background: isHighlighted
                        ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                        : 'var(--surface-1)',
                      color: isHighlighted ? '#fff' : 'var(--brand-600)',
                      border: isHighlighted ? 'none' : '1px solid rgba(16,185,129,0.3)',
                      boxShadow: isHighlighted ? '0 8px 22px rgba(16,185,129,0.32)' : undefined
                    }}
                  >
                    Começar com {n === 1 ? '1 canal' : `${n} canais`}
                  </button>
                </article>
              );
            })}
      </div>

      <p
        className="mt-6 px-4 py-3 rounded-xl text-[11px] text-center border"
        style={{
          borderColor: 'var(--border-subtle)',
          color: 'var(--text-3)',
          background: 'var(--surface-1)'
        }}
      >
        Desconto Pix ({pixPct}%) no pagamento quando disponível · upgrade pró-rata no meio do ciclo
        {fromCheckout ? ' · valores alinhados ao checkout' : ''}
      </p>
    </div>
  );
};

const BenefitTile: React.FC<{ icon: React.ReactNode; title: string; text: string }> = ({ icon, title, text }) => (
  <li
    className="flex gap-3 rounded-xl px-3 py-3 border transition-all hover:-translate-y-0.5 hover:shadow-sm"
    style={{
      background: 'var(--surface-0)',
      borderColor: 'var(--border-subtle)'
    }}
  >
    <div
      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
      style={{
        background: 'linear-gradient(145deg, rgba(16,185,129,0.18), rgba(16,185,129,0.06))',
        color: 'var(--brand-600)',
        border: '1px solid rgba(16,185,129,0.18)'
      }}
    >
      {icon}
    </div>
    <div className="min-w-0">
      <p className="text-[13px] font-bold leading-tight" style={{ color: 'var(--text-1)' }}>
        {title}
      </p>
      <p className="text-[11.5px] leading-snug mt-1" style={{ color: 'var(--text-3)' }}>
        {text}
      </p>
    </div>
  </li>
);

const StepCard: React.FC<{ n: number; title: string; text: string }> = ({ n, title, text }) => (
  <div
    className="relative rounded-2xl p-5 sm:p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg"
    style={{
      background: 'var(--surface-0)',
      border: '1px solid var(--border-subtle)',
      boxShadow: 'var(--shadow-xs)'
    }}
  >
    <div
      className="relative z-[1] w-12 h-12 rounded-2xl flex items-center justify-center mb-4 text-[15px] font-extrabold"
      style={{
        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        color: '#fff',
        boxShadow: '0 8px 22px rgba(16,185,129,0.32)'
      }}
    >
      {n}
    </div>
    <p className="text-[15px] sm:text-[16px] font-extrabold mb-1.5 tracking-tight" style={{ color: 'var(--text-1)' }}>
      {title}
    </p>
    <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
      {text}
    </p>
  </div>
);

const FaqItem: React.FC<{ q: string; a: React.ReactNode; id?: string }> = ({ q, a, id }) => (
  <details
    id={id}
    className="group rounded-2xl overflow-hidden transition-colors scroll-mt-24"
    style={{
      background: 'var(--surface-0)',
      border: '1px solid var(--border-subtle)'
    }}
  >
    <summary
      className="flex items-center justify-between gap-3 px-4 py-3.5 cursor-pointer list-none select-none transition-colors hover:bg-black/[0.02]"
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
