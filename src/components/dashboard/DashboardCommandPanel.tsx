/**
 * Hero do Painel — hierarquia: (1) o que fazer agora, (2) pulso do dia, (3) mapa + atalhos.
 */
import React, { useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  Eye,
  Flame,
  Globe2,
  LayoutDashboard,
  MessageCircle,
  Rocket,
  Send,
  Smartphone,
  TrendingUp,
  UserPlus,
  Users,
  CheckCheck,
  FolderInput,
} from 'lucide-react';
import type { Campaign, Contact, DashboardMetrics } from '../../types';
import { CampaignStatus } from '../../types';
import { TerritoryMapTeaser } from './TerritoryMapTeaser';
import { Button, ZmGlassCard, ZmMetricCard, ZmPageHeader } from '../ui';
import {
  WelcomeChecklistCard,
  type WelcomeChecklistProgress,
} from '../onboarding/welcomeChecklistShared';

type NavView = 'campaigns' | 'connections' | 'contacts' | 'contacts-map' | 'warmup' | 'team' | 'help';
type Props = {
  firstName: string;
  greeting: string;
  segmentTagline?: string;
  isBackendConnected: boolean;
  now: Date;
  onlineCount: number;
  connectionsTotal: number;
  metrics: DashboardMetrics;
  deliveryRate: number;
  readRate: number;
  replyRate: number;
  animSent: number;
  animDelivered: number;
  animRead: number;
  animReplied: number;
  campaigns: Campaign[];
  contacts: Contact[];
  contactsSavedTotal?: number | null;
  bestWindow?: { label: string } | null;
  onNavigate: (view: NavView) => void;
  onScrollAnalytics: () => void;
  hideStatusBar?: boolean;
  welcomeProgress?: WelcomeChecklistProgress;
  showWelcomeChecklist?: boolean;
  onWelcomeDismiss?: () => void;
  runningCampaigns?: number;
};

const fmt = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(n));

const navItems: Array<{ id: NavView; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'campaigns', label: 'Campanhas', icon: Rocket },
  { id: 'connections', label: 'Canais', icon: Smartphone },
  { id: 'contacts', label: 'Contatos', icon: Users },
  { id: 'contacts-map', label: 'Mapa', icon: Globe2 },
  { id: 'warmup', label: 'Aquecimento', icon: Flame },
  { id: 'help', label: 'Guia', icon: BookOpen },
];

export const DashboardCommandPanel: React.FC<Props> = (props) => {
  const {
    firstName,
    greeting,
    segmentTagline,
    isBackendConnected,
    now,
    onlineCount,
    connectionsTotal,
    campaigns,
    contacts,
    contactsSavedTotal,
    animSent,
    animDelivered,
    animRead,
    animReplied,
    deliveryRate,
    readRate,
    replyRate,
    onNavigate,
    onScrollAnalytics,
    welcomeProgress,
    showWelcomeChecklist,
    onWelcomeDismiss,
    runningCampaigns,
  } = props;

  const [moreMetricsOpen, setMoreMetricsOpen] = useState(false);

  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const contactCount = contactsSavedTotal ?? contacts.length;
  const running =
    runningCampaigns ?? campaigns.filter((c) => c.status === CampaignStatus.RUNNING).length;

  const contextLine = [
    `${greeting}, ${firstName}`,
    isBackendConnected ? 'Online' : 'Reconectando',
    connectionsTotal > 0 ? `${onlineCount}/${connectionsTotal} canais` : null,
    `${timeStr} · ${dateStr}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const onboardingIncomplete = showWelcomeChecklist && welcomeProgress && onWelcomeDismiss;

  return (
    <div className="zm-dash-section space-y-5 max-w-6xl mx-auto w-full">
      <ZmPageHeader
        icon={<LayoutDashboard className="w-5 h-5 text-emerald-400" />}
        title="Seu painel"
        subtitle={
          segmentTagline ||
          'Comece pelo essencial: conecte um canal, importe contatos e acompanhe o que importa hoje.'
        }
        actions={
          <>
            <Button
              type="button"
              variant="primary"
              size="sm"
              leftIcon={<Rocket className="w-3.5 h-3.5" />}
              onClick={() => onNavigate('campaigns')}
            >
              Nova campanha
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<TrendingUp className="w-3.5 h-3.5" />}
              onClick={onScrollAnalytics}
            >
              Ver desempenho
            </Button>
          </>
        }
        footer={
          <div className="px-4 sm:px-5 py-3">
            <p className="text-[12px] font-medium truncate" style={{ color: 'var(--text-3)' }}>
              {contextLine}
            </p>
          </div>
        }
      />

      {/* (A) O que fazer agora */}
      {onboardingIncomplete ? (
        <WelcomeChecklistCard
          progress={welcomeProgress}
          onNavigate={onNavigate}
          onDismiss={onWelcomeDismiss}
        />
      ) : connectionsTotal === 0 ? (
        <ZmGlassCard padding="md" hover className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 brand-soft">
            <Smartphone className="w-6 h-6" style={{ color: 'var(--brand-400)' }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="ui-title text-[15px]">Próximo passo: conectar WhatsApp</p>
            <p className="ui-subtitle text-[13px] mt-0.5">
              Sem um canal ativo não há envios nem métricas ao vivo. Leva poucos minutos escanear o QR.
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            leftIcon={<Smartphone className="w-4 h-4" />}
            onClick={() => onNavigate('connections')}
          >
            Conectar agora
          </Button>
        </ZmGlassCard>
      ) : contactCount === 0 ? (
        <ZmGlassCard padding="md" hover className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 brand-soft">
            <FolderInput className="w-6 h-6" style={{ color: 'var(--brand-400)' }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="ui-title text-[15px]">Importe sua base de contatos</p>
            <p className="ui-subtitle text-[13px] mt-0.5">
              Planilha, vCard ou sync do celular — sua lista alimenta campanhas e o mapa por região.
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            leftIcon={<Users className="w-4 h-4" />}
            onClick={() => onNavigate('contacts')}
          >
            Ir para Contatos
          </Button>
        </ZmGlassCard>
      ) : campaigns.length === 0 ? (
        <ZmGlassCard padding="md" hover className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 brand-soft">
            <Rocket className="w-6 h-6" style={{ color: 'var(--brand-400)' }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="ui-title text-[15px]">Dispare sua primeira campanha</p>
            <p className="ui-subtitle text-[13px] mt-0.5">
              Canal e contatos prontos — crie uma mensagem com intervalo anti-ban (15–45 s) e acompanhe aqui.
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            leftIcon={<Rocket className="w-4 h-4" />}
            onClick={() => onNavigate('campaigns')}
          >
            Criar campanha
          </Button>
        </ZmGlassCard>
      ) : null}

      {/* (B) Pulso de hoje — 4 métricas-chave */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-3 px-0.5">
          <h2 className="ui-title text-[15px]" style={{ color: 'var(--text-1)' }}>
            Pulso de hoje
          </h2>
          <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
            números acumulados da conta
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <ZmMetricCard
            label="Mensagens enviadas"
            value={fmt(animSent)}
            icon={<Send className="w-4 h-4" />}
            helper={animSent > 0 ? `${deliveryRate}% chegaram ao destino` : 'Dispare uma campanha para começar'}
            accent="emerald"
          />
          <ZmMetricCard
            label="Taxa de resposta"
            value={animSent > 0 ? `${replyRate}%` : '—'}
            icon={<MessageCircle className="w-4 h-4" />}
            helper={
              animReplied > 0
                ? `${fmt(animReplied)} respostas no total`
                : 'Quanto mais personalizado, maior a conversa'
            }
            accent="amber"
          />
          <ZmMetricCard
            label="Canais ativos"
            value={connectionsTotal > 0 ? `${onlineCount}/${connectionsTotal}` : '0'}
            icon={<Smartphone className="w-4 h-4" />}
            helper={
              connectionsTotal === 0
                ? 'Conecte seu primeiro chip'
                : onlineCount < connectionsTotal
                  ? 'Reconecte os offline em Canais'
                  : 'Todos online'
            }
            accent="cyan"
            onClick={() => onNavigate('connections')}
          />
          <ZmMetricCard
            label="Contatos salvos"
            value={fmt(contactCount)}
            icon={<Users className="w-4 h-4" />}
            helper={contactCount > 0 ? 'Base pronta para segmentar' : 'Importe ou sincronize'}
            accent="violet"
            onClick={() => onNavigate('contacts')}
          />
        </div>

        <div className="mt-3">
          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-semibold transition-colors hover:bg-white/5"
            style={{ color: 'var(--brand-500)', border: '1px dashed var(--border-subtle)' }}
            aria-expanded={moreMetricsOpen}
            onClick={() => setMoreMetricsOpen((v) => !v)}
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${moreMetricsOpen ? 'rotate-180' : ''}`} />
            {moreMetricsOpen ? 'Ocultar métricas extras' : 'Ver mais métricas'}
          </button>
          {moreMetricsOpen && (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mt-3 animate-in fade-in duration-200">
              <ZmMetricCard
                label="Entregues"
                value={fmt(animDelivered)}
                icon={<CheckCheck className="w-4 h-4" />}
                helper={`${deliveryRate}% do enviado`}
                accent="cyan"
              />
              <ZmMetricCard
                label="Lidas"
                value={fmt(animRead)}
                icon={<Eye className="w-4 h-4" />}
                helper={`${readRate}% dos entregues`}
                accent="pink"
              />
              <ZmMetricCard
                label="Campanhas"
                value={campaigns.length}
                icon={<Rocket className="w-4 h-4" />}
                helper={running > 0 ? `${running} em disparo agora` : 'Nenhuma em andamento'}
                accent="emerald"
                onClick={() => onNavigate('campaigns')}
              />
            </div>
          )}
        </div>
      </div>

      {/* Mapa — só quando há base para explorar */}
      {contactCount > 0 ? (
        <ZmGlassCard padding="md">
          <TerritoryMapTeaser
            contacts={contacts}
            contactsSavedTotal={contactsSavedTotal}
            onOpenMap={() => onNavigate('contacts-map')}
          />
        </ZmGlassCard>
      ) : null}

      <nav className="zm-bottom-dock" aria-label="Atalhos do painel">
        {navItems.map((item) => (
          <button key={item.id} type="button" className="zm-bottom-dock__btn" onClick={() => onNavigate(item.id)}>
            <item.icon className="w-3.5 h-3.5" />
            {item.label}
          </button>
        ))}
        <button type="button" className="zm-bottom-dock__btn zm-bottom-dock__btn--accent" onClick={() => onNavigate('team')}>
          <UserPlus className="w-3.5 h-3.5" />
          Convidar equipe
        </button>
      </nav>
    </div>
  );
};
