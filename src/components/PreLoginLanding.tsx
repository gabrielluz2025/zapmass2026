import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  MessageCircle,
  Send,
  Sparkles,
  Users,
  Zap
} from 'lucide-react';
import { LoginCard } from './auth/LoginCard';
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

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-8 lg:py-14 lg:grid lg:grid-cols-[1.05fr_0.92fr] lg:gap-10 lg:items-start">
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
              onClick={() => trackLandingEvent('landing_cta_click', { cta_id: 'header_planos' })}
              className="hidden sm:inline-flex text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors"
              style={{
                color: 'var(--text-2)'
              }}
            >
              Planos
            </a>
            <a
              href="#faq"
              onClick={() => trackLandingEvent('landing_cta_click', { cta_id: 'header_faq' })}
              className="hidden sm:inline-flex text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors"
              style={{
                color: 'var(--text-2)'
              }}
            >
              Dúvidas
            </a>
            <a
              href="#acesso"
              onClick={() => trackLandingEvent('landing_cta_click', { cta_id: 'header_start_free' })}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[12.5px] font-bold text-white transition-all hover:brightness-110 hover:scale-[1.02] active:scale-[0.98] shadow-lg"
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                boxShadow: '0 8px 24px rgba(16,185,129,0.35)'
              }}
            >
              Começar grátis
              <ArrowRight className="w-4 h-4 opacity-90" />
            </a>
          </div>
        </header>

        {/* Coluna esquerda — mensagem principal */}
        <div className="lg:col-start-1 space-y-6 mb-10 lg:mb-0 animate-fade-in-up" style={{ animationDelay: '80ms' }}>
          <div
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-[10.5px] font-bold uppercase tracking-widest"
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
            className="text-3xl sm:text-[2.65rem] font-black leading-[1.08] tracking-tight max-w-[22rem] sm:max-w-xl"
            style={{ color: 'var(--text-1)' }}
          >
            Disparos no WhatsApp{' '}
            <span className="text-gradient-brand">organizados</span>
            {' '}para você vender com consistência.
          </h2>

          <p className="text-[15px] leading-relaxed max-w-lg" style={{ color: 'var(--text-2)' }}>
            Um painel para campanhas, base de contatos, atendimento e métricas — sem improviso na operação.
          </p>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
            <a
              href="#acesso"
              onClick={() => trackLandingEvent('landing_cta_click', { cta_id: 'hero_google_anchor' })}
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-[14px] font-bold text-white transition-all hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 55%, #047857 100%)',
                boxShadow: '0 14px 32px rgba(16,185,129,0.35)'
              }}
            >
              Começar grátis — Google, Apple ou Facebook
              <ArrowRight className="w-4 h-4 opacity-95" />
            </a>
            <a
              href="#planos"
              onClick={() => trackLandingEvent('landing_cta_click', { cta_id: 'hero_view_plans' })}
              className="inline-flex items-center justify-center px-5 py-3 rounded-xl text-[13px] font-semibold border transition-colors hover:bg-black/[0.03]"
              style={{
                color: 'var(--text-2)',
                borderColor: 'var(--border-subtle)',
                background: 'var(--surface-0)'
              }}
            >
              Ver planos e valores
            </a>
          </div>

          {/* Teste grátis + destaques — cartão mais suave (sem grelha rígida) */}
          <div
            className="rounded-3xl max-w-xl p-5 sm:p-6"
            style={{
              background:
                'linear-gradient(165deg, var(--surface-0) 0%, rgba(16,185,129,0.06) 42%, var(--surface-0) 100%)',
              border: '1px solid rgba(16,185,129,0.18)',
              boxShadow: '0 12px 48px rgba(0,0,0,0.14)'
            }}
          >
            <div className="flex items-start gap-4">
              <div
                className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ring-1 ring-emerald-500/25"
                style={{
                  background: 'linear-gradient(145deg, rgba(16,185,129,0.25), rgba(16,185,129,0.06))',
                  color: 'var(--brand-600)'
                }}
              >
                <Sparkles className="w-5 h-5" strokeWidth={2} />
              </div>
              <div className="min-w-0 space-y-2">
                <p className="text-[15px] sm:text-[16px] font-bold leading-snug tracking-tight" style={{ color: 'var(--text-1)' }}>
                  {trialTitle}
                </p>
                <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                  {trialBody}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-5">
              <HeroStatPill value="1 a 5 canais" hint="por plano no checkout" />
              <HeroStatPill value="Pix −5%" hint="desconto no pagamento" />
              <HeroStatPill value="24/7" hint="rodando na nuvem" />
            </div>

            <div
              className="mt-5 rounded-2xl px-4 py-4 space-y-3"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
            >
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-3)' }}>
                Incluso na conta
              </p>
              <ul className="space-y-2.5 text-[13px] leading-snug" style={{ color: 'var(--text-2)' }}>
                <li className="flex gap-3 items-start">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" aria-hidden />
                  <span>
                    <span className="font-semibold" style={{ color: 'var(--text-1)' }}>
                      Gestor
                    </span>{' '}
                    — login com Google, Apple ou Facebook.
                  </span>
                </li>
                <li className="flex gap-3 items-start">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" aria-hidden />
                  <span>
                    <span className="font-semibold" style={{ color: 'var(--text-1)' }}>
                      Equipe
                    </span>{' '}
                    — usuários criados por você no painel.
                  </span>
                </li>
                <li className="flex gap-3 items-start">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" aria-hidden />
                  <span className="font-semibold" style={{ color: 'var(--text-1)' }}>
                    Dados isolados por conta.
                  </span>
                </li>
              </ul>
            </div>
          </div>

          <div className="max-w-xl pt-1">
            <div className="mb-3">
              <h3 className="text-[15px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
                O que o painel entrega
              </h3>
              <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--text-3)' }}>
                Quatro pilares para campanhas e atendimento sem dispersão.
              </p>
            </div>
            <ul className="grid sm:grid-cols-2 gap-2.5">
              <BenefitTile
                icon={<Send className="w-3.5 h-3.5" />}
                title="Campanhas com ritmo seguro"
                text="Limites por canal e pausas inteligentes."
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

        {/* Coluna direita — acesso */}
        <div
          id="acesso"
          className="lg:col-start-2 space-y-4 animate-fade-in-up scroll-mt-24 lg:sticky lg:top-8 lg:self-start"
          style={{ animationDelay: '160ms' }}
        >
          <LoginCard
            landingLayout
            showTrialOption
            title="Crie sua conta em um passo"
            subtitle="Gestor: no primeiro acesso com Google, Apple ou Facebook o teste é ativado. Equipe: use a aba Funcionário com usuário criado pelo gestor."
          />
          <p className="text-[10.5px] text-center max-w-md mx-auto leading-snug" style={{ color: 'var(--text-3)' }}>
            Ao entrar você aceita as políticas do ZapMass. Dúvidas sobre responsabilidades com o WhatsApp e a LGPD:{' '}
            <a
              href="#faq-whatsapp-lgpd"
              className="font-semibold underline underline-offset-2 hover:opacity-90"
              style={{ color: 'var(--brand-600)' }}
            >
              ver FAQ
            </a>
            {' '}ou <strong className="font-semibold">Configurações → WhatsApp / LGPD</strong> depois do login.
          </p>
        </div>

        {/* =============== PLANOS (visíveis antes do login) =============== */}
        <section id="planos" className="lg:col-span-2 mt-16 scroll-mt-24 animate-fade-in-up" style={{ animationDelay: '240ms' }}>
          <LandingPlanCards />

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

          <p
            className="text-center text-[12px] mt-6 max-w-2xl mx-auto"
            style={{ color: 'var(--text-3)' }}
          >
            Os valores são carregados do servidor ao abrir a página — os mesmos do checkout Mercado Pago (incluindo ajustes por
            variáveis de ambiente no deploy). Sem taxas escondidas no produto; condições do Mercado Pago valem para o método de
            pagamento escolhido. Se o servidor não responder, mostramos os preços base de referência.
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
              a={`Não. O teste grátis de ${formatTrialHoursLabel(config.trialHours)} libera o sistema completo sem cartão. Se você não contratar depois, apenas os envios ficam bloqueados.`}
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

const CHANNEL_TIERS = [1, 2, 3, 4, 5] as const;

const HeroStatPill: React.FC<{ value: string; hint: string }> = ({ value, hint }) => (
  <div
    className="rounded-2xl px-3.5 py-2.5 sm:px-4 border flex-1 min-w-[140px] sm:min-w-0 sm:flex-none"
    style={{
      background: 'var(--surface-1)',
      borderColor: 'rgba(16,185,129,0.22)'
    }}
  >
    <p className="text-[13px] font-bold tracking-tight" style={{ color: 'var(--text-1)' }}>
      {value}
    </p>
    <p className="text-[10.5px] mt-1 leading-snug" style={{ color: 'var(--text-3)' }}>
      {hint}
    </p>
  </div>
);

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
const LandingPlanCards: React.FC = () => {
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
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 mb-8 lg:mb-10">
        <div className="max-w-xl">
          <h3 className="text-2xl sm:text-3xl lg:text-[2rem] font-black tracking-tight" style={{ color: 'var(--text-1)' }}>
            Escolha seu plano
          </h3>
          <p className="text-[14px] sm:text-[15px] mt-2 leading-relaxed" style={{ color: 'var(--text-3)' }}>
            Quanto mais canais, menor o custo por canal.{' '}
            <span style={{ color: 'var(--text-2)' }}>Valores iguais ao checkout Mercado Pago após o login.</span>
          </p>
        </div>

        <div
          className="inline-flex items-center gap-1 p-1 rounded-full shrink-0 self-start lg:self-center border"
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

      <div className="flex lg:grid lg:grid-cols-5 gap-4 overflow-x-auto pb-3 lg:pb-0 snap-x snap-mandatory lg:snap-none -mx-1 px-1 [scrollbar-width:thin]">
        {loadState === 'loading'
          ? CHANNEL_TIERS.map((n) => (
              <div
                key={n}
                className="min-w-[260px] lg:min-w-0 snap-center shrink-0 rounded-2xl h-[280px] animate-pulse border"
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

              return (
                <article
                  key={n}
                  className="relative min-w-[260px] lg:min-w-0 snap-center shrink-0 rounded-2xl p-5 flex flex-col border transition-shadow hover:shadow-lg"
                  style={{
                    background:
                      highlightPopular || highlightStarter
                        ? 'linear-gradient(180deg, var(--surface-0) 0%, rgba(15,23,42,0.45) 100%)'
                        : 'var(--surface-0)',
                    borderColor: highlightPopular
                      ? 'rgba(16,185,129,0.55)'
                      : highlightStarter
                        ? 'rgba(59,130,246,0.65)'
                        : 'var(--border-subtle)',
                    borderWidth: highlightPopular || highlightStarter ? 2 : 1,
                    boxShadow:
                      highlightPopular || highlightStarter ? '0 12px 40px rgba(0,0,0,0.2)' : 'var(--shadow-xs)'
                  }}
                >
                  {highlightStarter ? (
                    <div className="absolute -top-px left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1]">
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full whitespace-nowrap text-white shadow-md"
                        style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' }}
                      >
                        Indicado para começar
                      </span>
                    </div>
                  ) : null}
                  {highlightPopular ? (
                    <div className="absolute -top-px left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1]">
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full whitespace-nowrap text-white shadow-md"
                        style={{
                          background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)'
                        }}
                      >
                        Mais popular
                      </span>
                    </div>
                  ) : null}

                  <p className="text-[11px] font-bold uppercase tracking-widest mb-4 mt-2" style={{ color: 'var(--text-3)' }}>
                    {n === 1 ? '1 canal' : `${n} canais`}
                  </p>

                  <div className="mb-1">
                    <span className="text-[1.65rem] sm:text-[1.85rem] font-black tabular-nums tracking-tight" style={{ color: 'var(--text-1)' }}>
                      {brl(total)}
                    </span>
                    <span className="text-[13px] font-medium ml-1" style={{ color: 'var(--text-3)' }}>
                      {cycle === 'monthly' ? '/mês' : '/ano'}
                    </span>
                  </div>
                  {equivMonthly != null ? (
                    <p className="text-[11.5px] mb-4 min-h-[2.5rem]" style={{ color: 'var(--brand-600)' }}>
                      Equivale a {brl(equivMonthly)}/mês em média
                    </p>
                  ) : (
                    <p className="text-[11.5px] mb-4 min-h-[2.5rem]" style={{ color: 'var(--text-3)' }}>
                      Renovação mensal · cancele quando quiser
                    </p>
                  )}

                  <ul className="space-y-2.5 flex-1 text-[12.5px]" style={{ color: 'var(--text-2)' }}>
                    <li className="flex gap-2 items-start">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden />
                      <span>
                        <strong style={{ color: 'var(--text-1)' }}>{brl(perChannel)}</strong>{' '}
                        {cycle === 'monthly' ? 'por canal no mês' : 'por canal no ano'}
                      </span>
                    </li>
                    <li className="flex gap-2 items-start">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden />
                      Campanhas e base organizadas no painel
                    </li>
                    {n >= 2 ? (
                      <li className="flex gap-2 items-start">
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" aria-hidden />
                        Multi-WhatsApp ({n} números)
                      </li>
                    ) : null}
                  </ul>

                  <a
                    href="#acesso"
                    onClick={() => trackLandingEvent('landing_cta_click', { cta_id: `plan_card_${n}_${cycle}` })}
                    className="mt-5 inline-flex justify-center items-center w-full py-2.5 rounded-xl text-[12px] font-bold transition-colors border"
                    style={{
                      borderColor: 'rgba(16,185,129,0.35)',
                      color: 'var(--brand-600)',
                      background: 'rgba(16,185,129,0.08)'
                    }}
                  >
                    Começar com este plano
                  </a>
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
    className="flex gap-3 rounded-xl px-3 py-3 border"
    style={{
      background: 'var(--surface-0)',
      borderColor: 'var(--border-subtle)'
    }}
  >
    <div
      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
      style={{
        background: 'rgba(16,185,129,0.1)',
        color: 'var(--brand-600)'
      }}
    >
      {icon}
    </div>
    <div className="min-w-0">
      <p className="text-[12.5px] font-bold leading-tight" style={{ color: 'var(--text-1)' }}>
        {title}
      </p>
      <p className="text-[11px] leading-snug mt-1" style={{ color: 'var(--text-3)' }}>
        {text}
      </p>
    </div>
  </li>
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

const FaqItem: React.FC<{ q: string; a: React.ReactNode; id?: string }> = ({ q, a, id }) => (
  <details
    id={id}
    className="group rounded-xl overflow-hidden transition-colors scroll-mt-24"
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
