/**
 * Centro de comando — saudação compacta + atlas territorial em largura total.
 */
import React from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Flame,
  Globe2,
  Rocket,
  Send,
  Smartphone,
  TrendingUp,
  UserPlus,
  Users,
  Wifi,
  Zap,
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
  /** Oculta pills de status quando o PageShell já exibe a faixa. */
  hideStatusBar?: boolean;
};

const dockItems = [
  { id: 'campaigns' as const, label: 'Campanhas', icon: Rocket },
  { id: 'connections' as const, label: 'Canais', icon: Smartphone },
  { id: 'contacts' as const, label: 'Contatos', icon: Users },
  { id: 'contacts-map' as const, label: 'Mapa', icon: Globe2 },
  { id: 'warmup' as const, label: 'Aquecimento', icon: Flame },
  { id: 'help' as const, label: 'Guia', icon: BookOpen },
];

export const DashboardCommandPanel: React.FC<Props> = ({
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
  bestWindow,
  onNavigate,
  onScrollFunnel,
  hideStatusBar = false,
}) => {
  return (
    <section className="zm-command-v3 zm-dash-section">
      {!hideStatusBar && (
      <header className="zm-command-v3__status">
        <span
          className={`zm-command-v3__pill ${isBackendConnected ? 'zm-command-v3__pill--ok' : 'zm-command-v3__pill--warn'}`}
        >
          <span className="zm-command-v3__dot" />
          {isBackendConnected ? 'Online' : 'Reconectando'}
        </span>
        <span className="zm-command-v3__time">
          {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          {' · '}
          {now.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}
        </span>
        {connectionsTotal > 0 && (
          <span className="zm-command-v3__channels">
            <Wifi className="w-3.5 h-3.5" />
            {onlineCount}/{connectionsTotal}
          </span>
        )}
      </header>
      )}

      <div className="zm-command-v3__intro">
        <div className="zm-command-v3__greet">
          <h1>
            {greeting}, <span>{firstName}</span>
          </h1>
          {segmentTagline && !hideStatusBar && <p>{segmentTagline}</p>}
          <div className="zm-command-v3__tags">
            {bestWindow && (
              <span>
                <Zap className="w-3 h-3" />
                Pico {bestWindow.label}
              </span>
            )}
            <span>
              <Users className="w-3 h-3" />
              {contacts.length.toLocaleString('pt-BR')} contatos
            </span>
            <span>
              <Send className="w-3 h-3" />
              {campaigns.length} campanhas
            </span>
          </div>
        </div>
        <div className="zm-command-v3__actions">
          <button type="button" className="zm-command-v3__primary" onClick={() => onNavigate('campaigns')}>
            <Rocket className="w-4 h-4" />
            Nova campanha
          </button>
          <button type="button" className="zm-command-v3__ghost" onClick={onScrollFunnel}>
            <TrendingUp className="w-4 h-4" />
            Funil
          </button>
          <button type="button" className="zm-command-v3__ghost" onClick={() => onNavigate('contacts')}>
            Contatos
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <TerritoryMapTeaser
        contacts={contacts}
        contactsSavedTotal={contactsSavedTotal}
        onOpenMap={() => onNavigate('contacts-map')}
      />

      <footer className="zm-command-v3__dock">
        {dockItems.map((item) => (
          <button key={item.id} type="button" onClick={() => onNavigate(item.id)}>
            <item.icon className="w-4 h-4" />
            {item.label}
          </button>
        ))}
        <button type="button" className="zm-command-v3__invite" onClick={() => onNavigate('team')}>
          <UserPlus className="w-4 h-4" />
          Convidar equipe
        </button>
      </footer>
    </section>
  );
};
