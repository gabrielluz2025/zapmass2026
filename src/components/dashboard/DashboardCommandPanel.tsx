/**
 * Hero strip — identidade visual nova v4.
 * Layout: título + status | KPIs em 4 tiles | nav pills flutuantes
 */
import React from 'react';
import {
  BookOpen,
  CheckCheck,
  Eye,
  Flame,
  Globe2,
  MessageCircle,
  Rocket,
  Send,
  Smartphone,
  TrendingUp,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { Campaign, Contact, DashboardMetrics } from '../../types';
import { TerritoryMapTeaser } from './TerritoryMapTeaser';

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

const navItems = [
  { id: 'campaigns'   as const, label: 'Campanhas',   icon: Rocket },
  { id: 'connections' as const, label: 'Canais',       icon: Smartphone },
  { id: 'contacts'    as const, label: 'Contatos',     icon: Users },
  { id: 'contacts-map'as const, label: 'Mapa',         icon: Globe2 },
  { id: 'warmup'      as const, label: 'Aquecimento',  icon: Flame },
  { id: 'help'        as const, label: 'Guia',         icon: BookOpen },
];

const fmt = (n: number) => n.toLocaleString('pt-BR');

export const DashboardCommandPanel: React.FC<Props> = ({
  firstName,
  greeting,
  isBackendConnected,
  now,
  onlineCount,
  connectionsTotal,
  animSent,
  animDelivered,
  animRead,
  animReplied,
  deliveryRate,
  readRate,
  replyRate,
  campaigns,
  contacts,
  contactsSavedTotal,
  onNavigate,
  onScrollFunnel,
}) => {
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="zm-dash-hero zm-dash-section">

      {/* ── Linha 1: identidade + ações ── */}
      <div className="zm-dash-hero__top">
        <div className="zm-dash-hero__identity">
          <h1 className="zm-dash-hero__greeting">
            {greeting}, <span>{firstName}</span>
          </h1>
          <div className="zm-dash-hero__meta">
            <span
              className="zm-dash-hero__status-dot"
              style={{ background: isBackendConnected ? 'var(--brand-500)' : '#f59e0b' }}
            />
            <span>{isBackendConnected ? 'Online' : 'Reconectando'}</span>
            {connectionsTotal > 0 && (
              <>
                <span className="zm-dash-hero__sep">·</span>
                {isBackendConnected
                  ? <Wifi className="w-3 h-3" />
                  : <WifiOff className="w-3 h-3" style={{ color: '#f59e0b' }} />
                }
                <span>{onlineCount}/{connectionsTotal} canais</span>
              </>
            )}
            <span className="zm-dash-hero__sep">·</span>
            <span>{timeStr} · {dateStr}</span>
          </div>
        </div>

        <div className="zm-dash-hero__actions">
          <button
            type="button"
            className="zm-dash-cta"
            onClick={() => onNavigate('campaigns')}
          >
            <Rocket className="w-3.5 h-3.5" />
            Nova campanha
          </button>
          <button
            type="button"
            className="zm-dash-cta zm-dash-cta--ghost"
            onClick={onScrollFunnel}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Funil
          </button>
          <button
            type="button"
            className="zm-dash-cta zm-dash-cta--ghost"
            onClick={() => onNavigate('team')}
          >
            <UserPlus className="w-3.5 h-3.5" />
            Equipe
          </button>
        </div>
      </div>

      {/* ── Linha 2: KPI tiles ── */}
      <div className="zm-dash-kpi-row">
        <div className="zm-dash-kpi zm-dash-kpi--sent">
          <div className="zm-dash-kpi__icon"><Send className="w-3.5 h-3.5" /></div>
          <div className="zm-dash-kpi__value">{fmt(animSent)}</div>
          <div className="zm-dash-kpi__label">Enviados</div>
        </div>
        <div className="zm-dash-kpi zm-dash-kpi--delivered">
          <div className="zm-dash-kpi__icon"><CheckCheck className="w-3.5 h-3.5" /></div>
          <div className="zm-dash-kpi__value">{fmt(animDelivered)}</div>
          <div className="zm-dash-kpi__label">Entregues · {deliveryRate}%</div>
        </div>
        <div className="zm-dash-kpi zm-dash-kpi--read">
          <div className="zm-dash-kpi__icon"><Eye className="w-3.5 h-3.5" /></div>
          <div className="zm-dash-kpi__value">{fmt(animRead)}</div>
          <div className="zm-dash-kpi__label">Lidos · {readRate}%</div>
        </div>
        <div className="zm-dash-kpi zm-dash-kpi--replied">
          <div className="zm-dash-kpi__icon"><MessageCircle className="w-3.5 h-3.5" /></div>
          <div className="zm-dash-kpi__value">{fmt(animReplied)}</div>
          <div className="zm-dash-kpi__label">Respondidos · {replyRate}%</div>
        </div>
        <div className="zm-dash-kpi zm-dash-kpi--contacts" style={{ cursor: 'pointer' }} onClick={() => onNavigate('contacts')}>
          <div className="zm-dash-kpi__icon"><Users className="w-3.5 h-3.5" /></div>
          <div className="zm-dash-kpi__value">{fmt(contactsSavedTotal ?? contacts.length)}</div>
          <div className="zm-dash-kpi__label">Contatos</div>
        </div>
        <div className="zm-dash-kpi zm-dash-kpi--campaigns" style={{ cursor: 'pointer' }} onClick={() => onNavigate('campaigns')}>
          <div className="zm-dash-kpi__icon"><Rocket className="w-3.5 h-3.5" /></div>
          <div className="zm-dash-kpi__value">{campaigns.length}</div>
          <div className="zm-dash-kpi__label">Campanhas</div>
        </div>
      </div>

      {/* ── Linha 3: mapa teaser ── */}
      <TerritoryMapTeaser
        contacts={contacts}
        contactsSavedTotal={contactsSavedTotal}
        onOpenMap={() => onNavigate('contacts-map')}
      />

      {/* ── Linha 4: nav pills ── */}
      <div className="zm-dash-nav-row">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className="zm-dash-nav-pill"
            onClick={() => onNavigate(item.id)}
          >
            <item.icon className="w-3.5 h-3.5" />
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className="zm-dash-nav-pill zm-dash-nav-pill--accent"
          onClick={() => onNavigate('team')}
        >
          <UserPlus className="w-3.5 h-3.5" />
          Convidar equipe
        </button>
      </div>
    </div>
  );
};
