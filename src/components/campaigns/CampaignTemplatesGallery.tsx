import React from 'react';
import {
  Cake,
  DollarSign,
  Gift,
  HandHeart,
  MessageCircleHeart,
  RefreshCcw,
  Sparkles
} from 'lucide-react';
import type { CampaignWizardDraft } from '../../types/campaignMission';

interface CampaignTemplate {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  color: string;
  badge?: string;
  buildDraft: () => CampaignWizardDraft;
}

const emptyDraft = (overrides: Partial<CampaignWizardDraft>): CampaignWizardDraft => ({
  name: '',
  sendMode: 'list',
  selectedListId: '',
  manualNumbers: '',
  selectedConnectionIds: [],
  channelWeightMode: 'equal',
  channelWeights: {},
  delaySeconds: 30,
  campaignFlowMode: 'sequential',
  messageStages: [],
  filterCities: [],
  filterChurches: [],
  filterRoles: [],
  filterProfessions: [],
  filterDDDs: [],
  filterTemps: [],
  filterSearch: '',
  selectedContactPhones: [],
  manualSelection: false,
  ...overrides
});

const stage = (
  body: string,
  opts?: { acceptAnyReply?: boolean; validTokens?: string; invalidReplyBody?: string }
) => ({
  id: `stage-${Math.random().toString(36).slice(2, 10)}`,
  body,
  acceptAnyReply: opts?.acceptAnyReply ?? true,
  validTokensText: opts?.validTokens ?? '',
  invalidReplyBody: opts?.invalidReplyBody ?? ''
});

const TEMPLATES: CampaignTemplate[] = [
  {
    id: 'welcome',
    title: 'Boas-vindas',
    subtitle: 'Apresente a marca e converse',
    icon: <HandHeart className="w-4 h-4" />,
    color: '#10b981',
    badge: 'Mais usado',
    buildDraft: () =>
      emptyDraft({
        name: 'Boas-vindas — novos contatos',
        campaignFlowMode: 'reply',
        delaySeconds: 45,
        messageStages: [
          stage(
            'Olá {{nome}}! 👋 Seja muito bem-vindo(a). Somos a equipe ZapMass e estamos felizes em ter você por aqui.\n\nPosso te apresentar nossos serviços em 1 minuto?'
          ),
          stage(
            'Perfeito! Aqui está um resumo rápido:\n\n✅ Disparo em massa seguro\n✅ Acompanhamento em tempo real\n✅ Suporte dedicado\n\nQuer agendar uma demonstração?'
          )
        ]
      })
  },
  {
    id: 'promo',
    title: 'Promoção / Oferta',
    subtitle: 'Crie urgência e converta',
    icon: <Gift className="w-4 h-4" />,
    color: '#f59e0b',
    buildDraft: () =>
      emptyDraft({
        name: 'Promoção relâmpago',
        delaySeconds: 25,
        messageStages: [
          stage(
            '🔥 {{nome}}, oferta relâmpago válida só HOJE!\n\n👉 Desconto de 30% em toda a linha premium\n👉 Frete grátis em compras acima de R$99\n\nResponda *SIM* que te mando o link.'
          )
        ]
      })
  },
  {
    id: 'reminder',
    title: 'Cobrança / Lembrete',
    subtitle: 'Tom amigável, ação clara',
    icon: <DollarSign className="w-4 h-4" />,
    color: '#3b82f6',
    buildDraft: () =>
      emptyDraft({
        name: 'Lembrete de pagamento',
        campaignFlowMode: 'reply',
        delaySeconds: 40,
        messageStages: [
          stage(
            'Olá {{nome}}, tudo bem? 🙂\n\nPassando pra lembrar que sua fatura vence em breve. Caso já tenha pago, desconsidere esta mensagem.\n\nPrecisa do link pra pagar ou de uma segunda via?'
          ),
          stage(
            'Perfeito! Aqui está o link seguro de pagamento: [cole o link aqui]\n\nQualquer dúvida, estamos por aqui.'
          )
        ]
      })
  },
  {
    id: 'post-sale',
    title: 'Pós-venda',
    subtitle: 'Avalie a experiência',
    icon: <MessageCircleHeart className="w-4 h-4" />,
    color: '#8b5cf6',
    buildDraft: () =>
      emptyDraft({
        name: 'Pesquisa pós-venda',
        campaignFlowMode: 'reply',
        delaySeconds: 60,
        messageStages: [
          stage(
            '{{nome}}, esperamos que esteja curtindo sua compra! 🎁\n\nEm uma escala de 1 a 5, como avalia a experiência?\n\n*Responda apenas com o número.*',
            {
              acceptAnyReply: false,
              validTokens: '1,2,3,4,5',
              invalidReplyBody: 'Por favor, responda apenas com um número de 1 a 5.'
            }
          ),
          stage(
            'Obrigado pela nota! Seu feedback é muito valioso. 💚\n\nQuer deixar um comentário sobre o que podemos melhorar?'
          )
        ]
      })
  },
  {
    id: 'reactivate',
    title: 'Reengajamento',
    subtitle: 'Traga clientes inativos',
    icon: <RefreshCcw className="w-4 h-4" />,
    color: '#ef4444',
    buildDraft: () =>
      emptyDraft({
        name: 'Reengajamento — clientes inativos',
        delaySeconds: 35,
        messageStages: [
          stage(
            'Oi {{nome}}! Faz um tempinho que não falamos 👀\n\nTemos novidades que podem te interessar — e um mimo especial pra te dar as boas-vindas de volta.\n\nPosso te mostrar?'
          )
        ]
      })
  },
  {
    id: 'birthday',
    title: 'Aniversário',
    subtitle: 'Mimo na data especial',
    icon: <Cake className="w-4 h-4" />,
    color: '#ec4899',
    buildDraft: () =>
      emptyDraft({
        name: 'Feliz aniversário 🎂',
        delaySeconds: 30,
        messageStages: [
          stage(
            '🎉 Feliz aniversário, {{nome}}! 🎂\n\nQue este novo ciclo traga muita saúde, alegrias e conquistas.\n\nComo presente, preparamos um cupom especial pra você: *ANIVERSARIO15* — 15% de desconto, válido por 7 dias.'
          )
        ]
      })
  }
];

interface CampaignTemplatesGalleryProps {
  onUseTemplate: (draft: CampaignWizardDraft) => void;
}

export const CampaignTemplatesGallery: React.FC<CampaignTemplatesGalleryProps> = ({
  onUseTemplate
}) => {
  return (
    <div className="ui-card" style={{ padding: 16 }}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(59,130,246,0.14))',
              border: '1px solid rgba(139,92,246,0.3)'
            }}
          >
            <Sparkles className="w-4 h-4 text-violet-500" />
          </div>
          <div className="min-w-0">
            <h3 className="ui-title text-[14.5px] truncate">Templates prontos</h3>
            <p className="text-[11.5px] leading-snug truncate" style={{ color: 'var(--text-3)' }}>
              Comece rápido — clique em um modelo e o wizard abre preenchido
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {TEMPLATES.map((tpl) => (
          <TemplateCard key={tpl.id} template={tpl} onClick={() => onUseTemplate(tpl.buildDraft())} />
        ))}
      </div>
    </div>
  );
};

const TemplateCard: React.FC<{ template: CampaignTemplate; onClick: () => void }> = ({
  template,
  onClick
}) => (
  <button
    type="button"
    onClick={onClick}
    className="group relative text-left rounded-xl p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
    style={{
      background: 'var(--surface-1)',
      border: '1px solid var(--border-subtle)'
    }}
  >
    <div
      className="absolute inset-0 pointer-events-none rounded-xl opacity-0 group-hover:opacity-100 transition-opacity"
      style={{
        background: `radial-gradient(220px 90px at 30% 0%, ${template.color}26, transparent 70%)`,
        border: `1px solid ${template.color}55`
      }}
      aria-hidden
    />
    {template.badge && (
      <span
        className="absolute top-1.5 right-1.5 text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
        style={{
          background: template.color,
          color: '#fff',
          boxShadow: `0 2px 6px ${template.color}88`
        }}
      >
        {template.badge}
      </span>
    )}
    <div className="relative">
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center mb-2"
        style={{
          background: `${template.color}1e`,
          color: template.color,
          border: `1px solid ${template.color}44`
        }}
      >
        {template.icon}
      </div>
      <p
        className="text-[13px] font-bold leading-tight"
        style={{ color: 'var(--text-1)' }}
      >
        {template.title}
      </p>
      <p
        className="text-[10.5px] mt-0.5 leading-snug"
        style={{ color: 'var(--text-3)' }}
      >
        {template.subtitle}
      </p>
    </div>
  </button>
);
