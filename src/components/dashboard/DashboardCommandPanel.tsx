/**
 * Hero do Painel — chrome neon (ZmPageHeader + ZmMetricCard + dock inferior).
 */
import React from 'react';
import {
  BookOpen,
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
} from 'lucide-react';
import type { Campaign, Contact, DashboardMetrics } from '../../types';
import { CampaignStatus } from '../../types';
import { TerritoryMapTeaser } from './TerritoryMapTeaser';
import { Button, ZmGlassCard, ZmMetricCard, ZmPageHeader } from '../ui';

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
  onScrollFunnel: () => void;
  hideStatusBar?: boolean;
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
    onScrollFunnel,
  } = props;

  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const contactCount = contactsSavedTotal ?? contacts.length;

  const contextLine = [
    `${greeting}, ${firstName}`,
    isBackendConnected ? 'Online' : 'Reconectando',
    connectionsTotal > 0 ? `${onlineCount}/${connectionsTotal} canais` : null,
    `${timeStr} · ${dateStr}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="zm-dash-section space-y-5 max-w-6xl mx-auto w-full">
      <ZmPageHeader
        icon={<LayoutDashboard className="w-5 h-5 text-emerald-400" />}
        title="Centro de comando"
        subtitle={segmentTagline || 'Visão geral de chips, campanhas, contatos e envios em tempo real.'}
        actions={
          <>
            <Button type="button" variant="primary" size="sm" leftIcon={<Rocket className="w-3.5 h-3.5" />} onClick={() => onNavigate('campaigns')}>
              Nova campanha
            </Button>
            <Button type="button" variant="secondary" size="sm" leftIcon={<TrendingUp className="w-3.5 h-3.5" />} onClick={onScrollFunnel}>
              Funil
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

      {connectionsTotal === 0 && (
        <ZmGlassCard padding="md" hover className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 brand-soft">
            <Smartphone className="w-6 h-6" style={{ color: 'var(--brand-400)' }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="ui-title text-[15px]">Nenhum canal conectado</p>
            <p className="ui-subtitle text-[13px] mt-0.5">
              Conecte seu primeiro WhatsApp em <strong style={{ color: 'var(--text-2)' }}>Canais</strong> para disparar campanhas e ver métricas ao vivo.
            </p>
          </div>
          <Button type="button" variant="primary" size="sm" leftIcon={<Smartphone className="w-4 h-4" />} onClick={() => onNavigate('connections')}>
            Conectar WhatsApp
          </Button>
        </ZmGlassCard>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <ZmMetricCard
          label="Enviados"
          value={fmt(animSent)}
          icon={<Send className="w-4 h-4" />}
          helper={`Taxa entrega ${deliveryRate}%`}
          accent="emerald"
        />
        <ZmMetricCard
          label="Entregues"
          value={fmt(animDelivered)}
          icon={<CheckCheck className="w-4 h-4" />}
          helper={`${deliveryRate}% do total`}
          accent="cyan"
        />
        <ZmMetricCard
          label="Lidos"
          value={fmt(animRead)}
          icon={<Eye className="w-4 h-4" />}
          helper={`${readRate}% dos entregues`}
          accent="violet"
        />
        <ZmMetricCard
          label="Respondidos"
          value={fmt(animReplied)}
          icon={<MessageCircle className="w-4 h-4" />}
          helper={`${replyRate}% taxa de resposta`}
          accent="amber"
        />
        <ZmMetricCard
          label="Contatos"
          value={fmt(contactCount)}
          icon={<Users className="w-4 h-4" />}
          helper="Base salva na conta"
          accent="emerald"
          onClick={() => onNavigate('contacts')}
        />
        <ZmMetricCard
          label="Campanhas"
          value={campaigns.length}
          icon={<Rocket className="w-4 h-4" />}
          helper={`${campaigns.filter((c) => c.status === CampaignStatus.RUNNING).length} em disparo`}
          accent="pink"
          onClick={() => onNavigate('campaigns')}
        />
      </div>

      <ZmGlassCard padding="md">
        <TerritoryMapTeaser
          contacts={contacts}
          contactsSavedTotal={contactsSavedTotal}
          onOpenMap={() => onNavigate('contacts-map')}
        />
      </ZmGlassCard>

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
