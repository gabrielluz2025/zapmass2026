/**
 * Centro de comando — visão estratégica + mapa territorial PRO (dark).
 */
import React from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Flame,
  Layers,
  MapPinned,
  Rocket,
  Send,
  Smartphone,
  TrendingUp,
  UserPlus,
  Users,
  Wifi,
  Zap,
} from 'lucide-react';
import type { Campaign, Contact, Conversation, DashboardMetrics } from '../../types';
import { FunnelOrbitVisual } from './FunnelOrbitVisual';
import { TerritoryLeadsMap } from './TerritoryLeadsMap';

type NavView = 'campaigns' | 'connections' | 'contacts' | 'warmup' | 'team' | 'help';

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
  conversations: Conversation[];
  bestWindow?: { label: string } | null;
  onNavigate: (view: NavView) => void;
  onScrollFunnel: () => void;
};

const dockItems = [
  { id: 'campaigns' as const, label: 'Campanhas', icon: Rocket },
  { id: 'connections' as const, label: 'Canais', icon: Smartphone },
  { id: 'contacts' as const, label: 'Contatos', icon: Users },
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
  replyRate,
  animSent,
  animDelivered,
  animRead,
  animReplied,
  deliveryRate,
  readRate,
  campaigns,
  contacts,
  conversations,
  bestWindow,
  onNavigate,
  onScrollFunnel,
}) => {
  const orbitRings = [
    { label: 'Enviadas', value: animSent, pct: 100, color: '#6366f1' },
    { label: 'Entregues', value: animDelivered, pct: deliveryRate, color: '#0ea5e9' },
    { label: 'Lidas', value: animRead, pct: readRate, color: '#a855f7' },
    { label: 'Respostas', value: animReplied, pct: replyRate, color: '#f97316' },
  ];

  const statTiles = [
    { label: 'Enviados', value: animSent, accent: '#818cf8' },
    { label: 'Entregues', value: animDelivered, accent: '#38bdf8', sub: `${deliveryRate}%` },
    { label: 'Lidos', value: animRead, accent: '#c084fc', sub: `${readRate}%` },
    { label: 'Respostas', value: animReplied, accent: '#fb923c', sub: `${replyRate}%` },
  ];

  return (
    <section className="zm-command-v2 zm-dash-section">
      <div className="zm-command-v2__mesh" aria-hidden />

      <header className="relative z-10 flex flex-wrap items-center gap-3 px-5 sm:px-7 py-3.5 border-b border-white/[0.06] bg-slate-950/90 text-white">
        <span
          className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest ${
            isBackendConnected ? 'text-emerald-400' : 'text-amber-400'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${isBackendConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}
          />
          {isBackendConnected ? 'Operação online' : 'Reconectando'}
        </span>
        <span className="hidden sm:inline text-[11px] text-slate-500 tabular-nums">
          {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          {' · '}
          {now.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}
        </span>
        {connectionsTotal > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sky-400/90">
            <Wifi className="w-3.5 h-3.5" />
            {onlineCount}/{connectionsTotal} canais
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.22em] text-indigo-300/70">
          <Layers className="w-3.5 h-3.5" />
          Intelligence Hub
        </span>
      </header>

      <div className="relative z-10 grid grid-cols-1 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="zm-command-v2__aside flex flex-col gap-5 border-b xl:border-b-0">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.24em] text-indigo-400/80 mb-2">
              Visão estratégica
            </p>
            <h1 className="text-[26px] sm:text-[30px] font-black text-white leading-[1.08] tracking-tight">
              {greeting},{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-violet-300 to-rose-300">
                {firstName}
              </span>
            </h1>
            {segmentTagline && (
              <p className="mt-2 text-[12px] text-slate-400 leading-relaxed">{segmentTagline}</p>
            )}
          </div>

          <div className="flex justify-center xl:justify-start">
            <FunnelOrbitVisual
              rings={orbitRings}
              centerLabel="engajamento"
              centerValue={`${replyRate}%`}
              onClick={onScrollFunnel}
              size={176}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            {statTiles.map((t) => (
              <div key={t.label} className="zm-command-v2__stat">
                <p className="zm-command-v2__stat-label">{t.label}</p>
                <p className="zm-command-v2__stat-value">{t.value.toLocaleString('pt-BR')}</p>
                {t.sub && (
                  <p className="text-[10px] font-bold mt-0.5" style={{ color: t.accent }}>
                    {t.sub}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate('campaigns')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-bold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-lg shadow-indigo-900/40 transition-all hover:-translate-y-0.5"
            >
              <Rocket className="w-4 h-4" />
              Nova campanha
            </button>
            <button
              type="button"
              onClick={onScrollFunnel}
              className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-[12px] font-semibold text-slate-300 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.07] transition-colors"
            >
              <TrendingUp className="w-4 h-4 text-indigo-400" />
              Funil
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mt-auto pb-1">
            {bestWindow && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-200 border border-amber-500/20">
                <Zap className="w-3 h-3" />
                Pico: <strong>{bestWindow.label}</strong>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-violet-500/10 text-violet-200 border border-violet-500/20">
              <Users className="w-3 h-3" />
              <strong>{contacts.length.toLocaleString('pt-BR')}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-200 border border-indigo-500/20">
              <Send className="w-3 h-3" />
              <strong>{campaigns.length}</strong> camp.
            </span>
          </div>
        </div>

        <div className="zm-command-v2__map-zone">
          <div className="zm-command-v2__map-header">
            <div>
              <p className="zm-command-v2__map-eyebrow">
                <MapPinned className="w-3.5 h-3.5" />
                Território de leads
              </p>
              <h2 className="zm-command-v2__map-title">
                Inteligência geográfica por bairro
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('contacts')}
              className="zm-command-v2__map-link"
            >
              Base de contatos
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <TerritoryLeadsMap
            contacts={contacts}
            conversations={conversations}
            defaultCity="Blumenau · SC"
            deferLoad
          />
        </div>
      </div>

      <footer className="relative z-10 flex flex-wrap items-center gap-2 px-5 sm:px-7 py-2.5 bg-black/40 border-t border-white/[0.05]">
        {dockItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <item.icon className="w-4 h-4 text-indigo-400" />
            {item.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onNavigate('team')}
          className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold text-orange-300/90 hover:text-white hover:bg-orange-500/10 transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Convidar equipe
        </button>
      </footer>
    </section>
  );
};
