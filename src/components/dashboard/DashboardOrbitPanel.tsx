/**
 * Painel Orbit — proposta visual nova para o Dashboard.
 * Dock vertical · funil orbital central · mapa colmeia na lateral (sem hero, sem cards repetidos).
 */
import React from 'react';
import {
  BookOpen,
  Flame,
  Rocket,
  Send,
  Smartphone,
  UserPlus,
  Users,
  Wifi,
  Zap,
} from 'lucide-react';
import type { Campaign, CampaignGeoState, Contact, DashboardMetrics } from '../../types';
import { BrasilNeonCanvas } from './BrasilNeonCanvas';
import { FunnelOrbitVisual } from './FunnelOrbitVisual';

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
  campaignGeo: CampaignGeoState;
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

export const DashboardOrbitPanel: React.FC<Props> = ({
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
  campaignGeo,
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

  return (
    <section className="zm-orbit zm-dash-section overflow-hidden rounded-[28px] border border-slate-200/90 shadow-[0_40px_100px_-48px_rgba(30,27,75,0.35)]">
      {/* Barra operacional fina */}
      <header className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-3 bg-slate-950 text-white border-b border-white/10">
        <span
          className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest ${
            isBackendConnected ? 'text-emerald-400' : 'text-amber-400'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${isBackendConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}
          />
          {isBackendConnected ? 'Sistema online' : 'Reconectando'}
        </span>
        <span className="text-[11px] text-white/45 tabular-nums">
          {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          {' · '}
          {now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' })}
        </span>
        {connectionsTotal > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-300/90">
            <Wifi className="w-3 h-3" />
            {onlineCount}/{connectionsTotal} canais
          </span>
        )}
        <span className="ml-auto text-[10px] font-extrabold uppercase tracking-[0.28em] text-indigo-300/80">
          Painel Orbit
        </span>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[72px_minmax(0,1fr)_minmax(220px,28%)] min-h-[520px]">
        {/* Dock vertical */}
        <nav
          className="hidden lg:flex flex-col items-center gap-1 py-4 px-2 bg-gradient-to-b from-indigo-950 via-indigo-900 to-violet-950 border-r border-white/10"
          aria-label="Atalhos principais"
        >
          {dockItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              title={item.label}
              className="zm-orbit-dock-btn group relative w-12 h-12 rounded-2xl flex items-center justify-center text-indigo-200/80 hover:text-white hover:bg-white/10 transition-all"
            >
              <item.icon className="w-5 h-5" />
              <span className="zm-orbit-dock-tip">{item.label}</span>
            </button>
          ))}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => onNavigate('team')}
            title="Convidar equipe"
            className="zm-orbit-dock-btn w-12 h-12 rounded-2xl flex items-center justify-center text-orange-300/90 hover:text-white hover:bg-orange-500/20 transition-all"
          >
            <UserPlus className="w-5 h-5" />
          </button>
        </nav>

        {/* Centro: orbital + saudação */}
        <div className="flex flex-col justify-center p-6 sm:p-8 bg-white min-h-[360px]">
          <div className="flex flex-col md:flex-row md:items-center gap-8 md:gap-10">
            <FunnelOrbitVisual
              rings={orbitRings}
              centerLabel="engajamento"
              centerValue={`${replyRate}%`}
              onClick={onScrollFunnel}
              size={240}
            />

            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600/80 mb-2">
                Visão geral
              </p>
              <h1 className="text-[32px] sm:text-[40px] font-black text-slate-900 leading-[1.02] tracking-tight">
                {greeting},
                <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-violet-600 to-orange-500">
                  {firstName}
                </span>
              </h1>
              {segmentTagline && (
                <p className="mt-3 text-[14px] text-slate-600 leading-relaxed max-w-md">{segmentTagline}</p>
              )}

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onNavigate('campaigns')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-lg shadow-indigo-500/25 transition-all hover:-translate-y-0.5"
                >
                  <Rocket className="w-4 h-4" />
                  Nova campanha
                </button>
                <button
                  type="button"
                  onClick={onScrollFunnel}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition-colors"
                >
                  Ver funil histórico
                </button>
              </div>
            </div>
          </div>

          {/* Chips + atalhos mobile */}
          <div className="mt-8 flex flex-wrap gap-2">
            {bestWindow && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-900 border border-amber-200">
                <Zap className="w-3.5 h-3.5" />
                Melhor horário: <strong>{bestWindow.label}</strong>
              </span>
            )}
            {contacts.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-violet-50 text-violet-900 border border-violet-200">
                <Users className="w-3.5 h-3.5" />
                <strong>{contacts.length.toLocaleString('pt-BR')}</strong> contatos
              </span>
            )}
            {campaigns.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-900 border border-indigo-200">
                <Send className="w-3.5 h-3.5" />
                <strong>{campaigns.length}</strong> campanhas
              </span>
            )}
            {metrics.totalSent === 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                Primeira campanha? Use o botão acima
              </span>
            )}
          </div>

          {/* Dock horizontal no mobile */}
          <div className="mt-6 flex lg:hidden gap-2 overflow-x-auto pb-1">
            {dockItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-bold text-slate-700 bg-slate-100 border border-slate-200"
              >
                <item.icon className="w-4 h-4 text-indigo-600" />
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Mapa lateral — único, compacto */}
        <aside className="border-t lg:border-t-0 lg:border-l border-slate-200/80 bg-slate-50/80 p-4 min-h-[280px] lg:min-h-0 flex flex-col">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-slate-500 mb-2">
            Território · mapa único
          </p>
          <div className="flex-1 min-h-[240px]">
            <BrasilNeonCanvas
              variant="sidebar"
              contacts={contacts}
              campaignGeo={campaignGeo}
              isLive={isBackendConnected}
            />
          </div>
        </aside>
      </div>
    </section>
  );
};
