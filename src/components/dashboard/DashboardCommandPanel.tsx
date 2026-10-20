/**
 * Hero do Painel — cabeçalho compacto (padrão criador v2.3.318+) e KPIs com StatCard.
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
import { Button, CompactPageHeader, StatCard } from '../ui';

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
    <div className="zm-dash-section space-y-4 max-w-5xl mx-auto w-full px-0 sm:px-0">
      <CompactPageHeader
        icon={<LayoutDashboard className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
        title="Painel"
        subtitle={segmentTagline || 'Visão geral de chips, campanhas, contatos e envios em tempo real.'}
        footer={
          <div
            className="px-4 sm:px-5 pb-3 flex flex-wrap items-center justify-between gap-2 border-t"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <p className="text-[12px] font-medium min-w-0 truncate" style={{ color: 'var(--text-3)' }}>
              {contextLine}
            </p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button type="button" variant="primary" size="sm" leftIcon={<Rocket className="w-3.5 h-3.5" />} onClick={() => onNavigate('campaigns')}>
                Nova campanha
              </Button>
              <Button type="button" variant="secondary" size="sm" leftIcon={<TrendingUp className="w-3.5 h-3.5" />} onClick={onScrollFunnel}>
                Funil
              </Button>
            </div>
          </div>
        }
      />

      {connectionsTotal === 0 && (
        <div
          className="rounded-xl border px-4 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4"
          style={{
            borderColor: 'color-mix(in srgb, var(--brand-500) 28%, var(--border-subtle))',
            background: 'color-mix(in srgb, var(--brand-500) 8%, var(--surface-0))',
          }}
        >
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 brand-soft"
          >
            <Smartphone className="w-6 h-6" style={{ color: 'var(--brand-600)' }} />
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
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <StatCard
          label="Enviados"
          value={fmt(animSent)}
          icon={<Send className="w-4 h-4 text-emerald-600" />}
          helper={`Taxa entrega ${deliveryRate}%`}
          accent="success"
        />
        <StatCard
          label="Entregues"
          value={fmt(animDelivered)}
          icon={<CheckCheck className="w-4 h-4 text-cyan-600" />}
          helper={`${deliveryRate}% do total`}
          accent="info"
        />
        <StatCard
          label="Lidos"
          value={fmt(animRead)}
          icon={<Eye className="w-4 h-4 text-indigo-500" />}
          helper={`${readRate}% dos entregues`}
          accent="info"
        />
        <StatCard
          label="Respondidos"
          value={fmt(animReplied)}
          icon={<MessageCircle className="w-4 h-4 text-amber-600" />}
          helper={`${replyRate}% taxa de resposta`}
          accent="warning"
        />
        <div role="presentation" onClick={() => onNavigate('contacts')} className="cursor-pointer">
          <StatCard
            label="Contatos"
            value={fmt(contactCount)}
            icon={<Users className="w-4 h-4 text-emerald-500" />}
            helper="Base salva na conta"
            accent="default"
            className="h-full hover:ring-1 hover:ring-[var(--border-subtle)] transition-shadow"
          />
        </div>
        <div role="presentation" onClick={() => onNavigate('campaigns')} className="cursor-pointer">
          <StatCard
            label="Campanhas"
            value={campaigns.length}
            icon={<Rocket className="w-4 h-4 text-pink-500" />}
            helper={`${campaigns.filter((c) => c.status === CampaignStatus.RUNNING).length} em disparo`}
            accent="default"
            className="h-full hover:ring-1 hover:ring-[var(--border-subtle)] transition-shadow"
          />
        </div>
      </div>

      <TerritoryMapTeaser
        contacts={contacts}
        contactsSavedTotal={contactsSavedTotal}
        onOpenMap={() => onNavigate('contacts-map')}
      />

      <div
        className="flex flex-wrap gap-2 pt-3"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12.5px] font-semibold transition-all hover:scale-[1.03]"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-2)',
            }}
          >
            <item.icon className="w-3.5 h-3.5" />
            {item.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onNavigate('team')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12.5px] font-semibold ml-auto transition-all hover:scale-[1.03]"
          style={{
            background: 'rgba(16,185,129,0.10)',
            border: '1px solid rgba(16,185,129,0.25)',
            color: 'var(--brand-400)',
          }}
        >
          <UserPlus className="w-3.5 h-3.5" /> Convidar equipe
        </button>
      </div>
    </div>
  );
};
