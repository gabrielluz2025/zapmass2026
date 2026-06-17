/**
 * Painel Pulse — proposta visual nova para o Dashboard.
 * Mapa único em hero full-bleed; métricas em trilho; funil horizontal; bento de atalhos.
 */
import React from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCheck,
  Flame,
  Reply,
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

const funnelNodes = (
  animSent: number,
  animDelivered: number,
  animRead: number,
  animReplied: number,
  deliveryRate: number,
  readRate: number,
  replyRate: number
) => [
  { label: 'Enviadas', val: animSent, pct: 100, color: '#0d9488', icon: Send },
  { label: 'Entregues', val: animDelivered, pct: deliveryRate, color: '#2563eb', icon: CheckCheck },
  { label: 'Lidas', val: animRead, pct: readRate, color: '#7c3aed', icon: CheckCheck },
  { label: 'Respostas', val: animReplied, pct: replyRate, color: '#ea580c', icon: Reply },
];

const quickTiles = [
  { id: 'campaigns' as const, label: 'Campanhas', hint: 'Disparos em massa', icon: Rocket, tint: '#0d9488' },
  { id: 'connections' as const, label: 'Canais', hint: 'QR e chips', icon: Smartphone, tint: '#2563eb' },
  { id: 'contacts' as const, label: 'Contatos', hint: 'Base e listas', icon: Users, tint: '#7c3aed' },
  { id: 'warmup' as const, label: 'Aquecimento', hint: 'Proteger números', icon: Flame, tint: '#ea580c' },
];

export const DashboardPulsePanel: React.FC<Props> = ({
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
  const nodes = funnelNodes(
    animSent,
    animDelivered,
    animRead,
    animReplied,
    deliveryRate,
    readRate,
    replyRate
  );

  return (
    <section className="zm-pulse zm-dash-section overflow-hidden rounded-[32px] border border-stone-200/90 bg-[#f5f2ed] shadow-[0_32px_90px_-40px_rgba(28,25,23,0.22)]">
      {/* Hero: mapa único em destaque */}
      <div className="relative min-h-[min(46vh,440px)] bg-gradient-to-b from-[#e8f4f2] via-[#faf8f5] to-[#f5f2ed]">
        <div className="absolute inset-0">
          <BrasilNeonCanvas
            variant="hero"
            contacts={contacts}
            campaignGeo={campaignGeo}
            isLive={isBackendConnected}
          />
        </div>

        <div className="absolute inset-x-0 bottom-0 z-10 px-5 sm:px-8 pb-6 pt-16 bg-gradient-to-t from-stone-900/88 via-stone-900/55 to-transparent pointer-events-none">
          <div className="pointer-events-auto max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.24em] text-teal-300/90">
                Painel Pulse
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  isBackendConnected ? 'bg-emerald-500/20 text-emerald-200' : 'bg-amber-500/20 text-amber-200'
                }`}
              >
                {isBackendConnected ? 'Online' : 'Reconectando'}
              </span>
              <span className="text-[11px] text-white/50 ml-auto tabular-nums">
                {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                {' · '}
                {now.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}
              </span>
              {connectionsTotal > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-white/80 bg-white/10 px-2 py-0.5 rounded-full">
                  <Wifi className="w-3 h-3" />
                  {onlineCount}/{connectionsTotal}
                </span>
              )}
            </div>

            <h1 className="text-[26px] sm:text-[34px] font-black text-white leading-[1.05] tracking-tight">
              {greeting},{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-orange-300">
                {firstName}
              </span>
            </h1>
            {segmentTagline && (
              <p className="mt-1.5 text-[13px] text-white/65 max-w-xl leading-relaxed">{segmentTagline}</p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onNavigate('campaigns')}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold text-stone-900 bg-white hover:bg-teal-50 transition-colors"
              >
                <Rocket className="w-4 h-4 text-teal-600" />
                Nova campanha
              </button>
              <button
                type="button"
                onClick={() => onNavigate('help')}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-semibold text-white/90 bg-white/10 hover:bg-white/15 border border-white/15 transition-colors"
              >
                <BookOpen className="w-3.5 h-3.5" />
                Guia
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Trilho de métricas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 p-4 sm:p-5 border-b border-stone-200/70 bg-white/60">
        {nodes.map((n) => (
          <button
            key={n.label}
            type="button"
            onClick={n.label === 'Enviadas' ? () => onNavigate('campaigns') : onScrollFunnel}
            className="group rounded-2xl px-4 py-3 text-left bg-white border border-stone-200/80 hover:border-teal-300/80 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-2 mb-1">
              <n.icon className="w-3.5 h-3.5" style={{ color: n.color }} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{n.label}</span>
            </div>
            <p className="text-[22px] font-black tabular-nums text-stone-900 leading-none">
              {n.val.toLocaleString('pt-BR')}
            </p>
            {n.label !== 'Enviadas' && (
              <p className="text-[11px] font-semibold mt-1 tabular-nums" style={{ color: n.color }}>
                {n.pct}%
              </p>
            )}
          </button>
        ))}
      </div>

      {/* Bento: funil horizontal + atalhos */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 sm:p-5">
        <div className="lg:col-span-7 rounded-[24px] bg-white border border-stone-200/80 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2 mb-5">
            <h2 className="text-[13px] font-extrabold uppercase tracking-wider text-stone-500">Jornada ao vivo</h2>
            <button
              type="button"
              onClick={onScrollFunnel}
              className="text-[11px] font-bold text-teal-700 hover:underline"
            >
              Funil completo
            </button>
          </div>

          <div className="relative flex items-start justify-between gap-1">
            <div
              className="absolute top-[18px] left-[8%] right-[8%] h-0.5 bg-stone-200 rounded-full"
              aria-hidden
            />
            {nodes.map((n, i) => (
              <button
                key={n.label}
                type="button"
                onClick={onScrollFunnel}
                className="relative flex-1 min-w-0 flex flex-col items-center gap-2 group"
              >
                <span
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[11px] font-black shadow-md ring-4 ring-white transition-transform group-hover:scale-105"
                  style={{ background: n.color }}
                >
                  {i + 1}
                </span>
                <span className="text-[10px] font-bold text-stone-500 text-center leading-tight">{n.label}</span>
                <span className="text-[13px] font-black tabular-nums text-stone-900">
                  {n.val.toLocaleString('pt-BR')}
                </span>
                <div className="w-full max-w-[72px] h-1 rounded-full bg-stone-100 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.max(n.pct, metrics.totalSent > 0 ? 6 : 0)}%`,
                      background: n.color,
                    }}
                  />
                </div>
              </button>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {bestWindow && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-orange-50 text-orange-800 border border-orange-200/80">
                <Zap className="w-3.5 h-3.5" />
                Melhor horário: <strong>{bestWindow.label}</strong>
              </span>
            )}
            {contacts.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-violet-50 text-violet-800 border border-violet-200/80">
                <Users className="w-3.5 h-3.5" />
                <strong>{contacts.length.toLocaleString('pt-BR')}</strong> na base
              </span>
            )}
            {campaigns.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-teal-50 text-teal-800 border border-teal-200/80">
                <Send className="w-3.5 h-3.5" />
                <strong>{campaigns.length}</strong> campanhas
              </span>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 flex-1">
            {quickTiles.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onNavigate(t.id)}
                className="rounded-2xl p-4 text-left bg-white border border-stone-200/80 hover:-translate-y-0.5 hover:shadow-lg transition-all group"
              >
                <span
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white mb-2"
                  style={{ background: t.tint }}
                >
                  <t.icon className="w-4 h-4" />
                </span>
                <span className="block text-[13px] font-bold text-stone-900">{t.label}</span>
                <span className="block text-[10px] text-stone-500 mt-0.5">{t.hint}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onNavigate('team')}
            className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left bg-gradient-to-r from-teal-600 to-teal-700 text-white hover:from-teal-500 hover:to-teal-600 transition-colors group"
          >
            <span className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <UserPlus className="w-5 h-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-bold">Convidar funcionário ou sócio</span>
              <span className="block text-[11px] text-white/75">Mesma conta, acesso com Google</span>
            </span>
            <ArrowRight className="w-4 h-4 opacity-80 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </div>
    </section>
  );
};
