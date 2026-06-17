/**
 * Painel Command — visão geral premium com mapa territorial real (OSM) e KPIs integrados.
 */
import React from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Flame,
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
  metrics,
  deliveryRate,
  readRate,
  replyRate,
  animSent,
  animDelivered,
  animRead,
  animReplied,
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
    { label: 'Enviados', value: animSent, accent: '#6366f1' },
    { label: 'Entregues', value: animDelivered, accent: '#0ea5e9', sub: `${deliveryRate}%` },
    { label: 'Lidos', value: animRead, accent: '#a855f7', sub: `${readRate}%` },
    { label: 'Respostas', value: animReplied, accent: '#f97316', sub: `${replyRate}%` },
  ];

  return (
    <section className="zm-command zm-dash-section overflow-hidden rounded-[28px] border border-stone-200/80 shadow-[0_48px_120px_-56px_rgba(49,46,129,0.45)]">
      <div className="zm-command-mesh" aria-hidden />

      <header className="relative z-10 flex flex-wrap items-center gap-3 px-5 sm:px-8 py-4 border-b border-white/10 bg-gradient-to-r from-slate-950 via-indigo-950 to-violet-950 text-white">
        <div className="flex items-center gap-3 min-w-0">
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
          <span className="hidden sm:inline text-[11px] text-white/40 tabular-nums">
            {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            {' · '}
            {now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' })}
          </span>
        </div>

        {connectionsTotal > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-sky-300/90">
            <Wifi className="w-3.5 h-3.5" />
            {onlineCount}/{connectionsTotal} canais ativos
          </span>
        )}

        <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.24em] text-indigo-200/70">
          <MapPinned className="w-3.5 h-3.5" />
          Centro de comando
        </span>
      </header>

      <div className="relative z-10 grid grid-cols-1 xl:grid-cols-[minmax(0,340px)_1fr] gap-0 bg-gradient-to-br from-white via-stone-50/80 to-indigo-50/40">
        {/* Coluna esquerda — saudação + funil */}
        <div className="p-6 sm:p-8 border-b xl:border-b-0 xl:border-r border-stone-200/70 flex flex-col gap-6">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.28em] text-indigo-600/70 mb-2">
              Visão estratégica
            </p>
            <h1 className="text-[28px] sm:text-[34px] font-black text-stone-900 leading-[1.05] tracking-tight">
              {greeting},{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-violet-600 to-rose-500">
                {firstName}
              </span>
            </h1>
            {segmentTagline && (
              <p className="mt-2 text-[13px] text-stone-600 leading-relaxed">{segmentTagline}</p>
            )}
          </div>

          <div className="flex justify-center xl:justify-start">
            <FunnelOrbitVisual
              rings={orbitRings}
              centerLabel="engajamento"
              centerValue={`${replyRate}%`}
              onClick={onScrollFunnel}
              size={200}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            {statTiles.map((t) => (
              <div
                key={t.label}
                className="zm-command-stat rounded-2xl border border-stone-200/80 bg-white/90 px-3 py-2.5 shadow-sm"
                style={{ '--zm-stat-accent': t.accent } as React.CSSProperties}
              >
                <p className="text-[9px] font-bold uppercase tracking-wider text-stone-400">{t.label}</p>
                <p className="text-[20px] font-black tabular-nums text-stone-900 leading-none mt-0.5">
                  {t.value.toLocaleString('pt-BR')}
                </p>
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
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-bold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-lg shadow-indigo-500/20 transition-all hover:-translate-y-0.5"
            >
              <Rocket className="w-4 h-4" />
              Nova campanha
            </button>
            <button
              type="button"
              onClick={onScrollFunnel}
              className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-[12px] font-semibold text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 transition-colors"
            >
              <TrendingUp className="w-4 h-4 text-indigo-600" />
              Funil histórico
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mt-auto">
            {bestWindow && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-900 border border-amber-200">
                <Zap className="w-3 h-3" />
                Melhor horário: <strong>{bestWindow.label}</strong>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-violet-50 text-violet-900 border border-violet-200">
              <Users className="w-3 h-3" />
              <strong>{contacts.length.toLocaleString('pt-BR')}</strong> contatos
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-900 border border-indigo-200">
              <Send className="w-3 h-3" />
              <strong>{campaigns.length}</strong> campanhas
            </span>
          </div>
        </div>

        {/* Coluna direita — mapa territorial */}
        <div className="p-5 sm:p-6 flex flex-col min-h-[480px]">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-indigo-600/80 flex items-center gap-1.5">
                <MapPinned className="w-3.5 h-3.5" />
                Território de leads
              </p>
              <h2 className="text-[18px] font-black text-stone-900 mt-1">
                Mapa por bairro · CEP e endereço
              </h2>
              <p className="text-[12px] text-stone-500 mt-1 max-w-lg">
                OpenStreetMap · Blumenau: 35 bairros oficiais com temperatura por região (mapa leve, sem
                milhares de pins).
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('contacts')}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 shrink-0"
            >
              Gerenciar contatos
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

      {/* Dock de atalhos */}
      <footer className="relative z-10 flex flex-wrap items-center gap-2 px-5 sm:px-8 py-3 bg-stone-950/95 border-t border-white/5">
        {dockItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold text-stone-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            <item.icon className="w-4 h-4 text-indigo-400" />
            {item.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onNavigate('team')}
          className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold text-orange-300/90 hover:text-white hover:bg-orange-500/15 transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Convidar equipe
        </button>
      </footer>
    </section>
  );
};
