/**
 * Hero strip v5 — Big numbers, clean layout, zero CSS bugs.
 * Usa apenas Tailwind + inline styles. Sem classes CSS externas.
 */
import React from 'react';
import {
  BookOpen, CheckCheck, Eye, Flame, Globe2,
  MessageCircle, Rocket, Send, Smartphone,
  TrendingUp, UserPlus, Users, Wifi, WifiOff,
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

const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(n);

const METRICS = (p: Props) => [
  { key: 'sent',      value: p.animSent,      label: 'Enviados',     sub: null,              color: '#10b981', icon: Send },
  { key: 'delivered', value: p.animDelivered,  label: 'Entregues',   sub: `${p.deliveryRate}%`, color: '#06b6d4', icon: CheckCheck },
  { key: 'read',      value: p.animRead,       label: 'Lidos',       sub: `${p.readRate}%`,   color: '#818cf8', icon: Eye },
  { key: 'replied',   value: p.animReplied,    label: 'Respondidos', sub: `${p.replyRate}%`,  color: '#f59e0b', icon: MessageCircle },
];

const navItems: Array<{ id: NavView; label: string; icon: React.ComponentType<{className?: string}> }> = [
  { id: 'campaigns',    label: 'Campanhas',  icon: Rocket },
  { id: 'connections',  label: 'Canais',     icon: Smartphone },
  { id: 'contacts',     label: 'Contatos',   icon: Users },
  { id: 'contacts-map', label: 'Mapa',       icon: Globe2 },
  { id: 'warmup',       label: 'Aquecimento',icon: Flame },
  { id: 'help',         label: 'Guia',       icon: BookOpen },
];

export const DashboardCommandPanel: React.FC<Props> = (props) => {
  const {
    firstName, greeting, isBackendConnected,
    now, onlineCount, connectionsTotal,
    campaigns, contacts, contactsSavedTotal,
    onNavigate, onScrollFunnel,
  } = props;

  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const metrics = METRICS(props);

  return (
    <div className="zm-dash-section space-y-5">

      {/* ── Linha 1: identidade + CTAs ─────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="text-3xl font-extrabold leading-none tracking-tight"
            style={{ color: 'var(--text-1)', letterSpacing: '-0.04em' }}
          >
            {greeting},{' '}
            <span style={{ color: 'var(--brand-500)' }}>{firstName}</span>
          </h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap" style={{ color: 'var(--text-3)', fontSize: '12px', fontWeight: 500 }}>
            <span
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{
                background: isBackendConnected ? 'var(--brand-500)' : '#f59e0b',
                boxShadow: isBackendConnected ? '0 0 6px rgba(16,185,129,0.7)' : 'none',
              }}
            />
            <span style={{ color: isBackendConnected ? 'var(--brand-400)' : '#f59e0b' }}>
              {isBackendConnected ? 'Online' : 'Reconectando'}
            </span>
            {connectionsTotal > 0 && (
              <>
                <span style={{ opacity: 0.3 }}>·</span>
                {isBackendConnected
                  ? <Wifi className="w-3 h-3" style={{ color: 'var(--text-3)' }} />
                  : <WifiOff className="w-3 h-3" style={{ color: '#f59e0b' }} />
                }
                <span>{onlineCount}/{connectionsTotal} canais</span>
              </>
            )}
            <span style={{ opacity: 0.3 }}>·</span>
            <span>{timeStr} · {dateStr}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('campaigns')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white transition-all hover:-translate-y-0.5"
            style={{
              background: 'var(--brand-500)',
              boxShadow: '0 4px 16px rgba(16,185,129,0.35)',
            }}
          >
            <Rocket className="w-4 h-4" /> Nova campanha
          </button>
          <button
            type="button"
            onClick={onScrollFunnel}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              color: 'var(--text-2)',
            }}
          >
            <TrendingUp className="w-4 h-4" /> Funil
          </button>
          <button
            type="button"
            onClick={() => onNavigate('team')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
              color: 'var(--text-2)',
            }}
          >
            <UserPlus className="w-4 h-4" /> Equipe
          </button>
        </div>
      </div>

      {/* ── Linha 2: KPI tiles ──────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {metrics.map((m) => (
          <div
            key={m.key}
            className="flex flex-col gap-1.5 rounded-xl p-4 transition-all hover:-translate-y-1 cursor-default"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border-subtle)',
              borderTop: `2px solid ${m.color}`,
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <m.icon className="w-4 h-4 flex-shrink-0" style={{ color: m.color }} />
            <div
              className="text-3xl font-extrabold leading-none tabular-nums"
              style={{ color: 'var(--text-1)', letterSpacing: '-0.04em' }}
            >
              {fmt(m.value)}
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--text-3)' }}
              >
                {m.label}
              </span>
              {m.sub && (
                <span
                  className="text-[10px] font-bold px-1 py-0.5 rounded"
                  style={{ background: `${m.color}22`, color: m.color }}
                >
                  {m.sub}
                </span>
              )}
            </div>
          </div>
        ))}
        {/* Tiles extras: contatos + campanhas */}
        <div
          className="flex flex-col gap-1.5 rounded-xl p-4 transition-all hover:-translate-y-1 cursor-pointer"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border-subtle)',
            borderTop: '2px solid #34d399',
            boxShadow: 'var(--shadow-sm)',
          }}
          onClick={() => onNavigate('contacts')}
        >
          <Users className="w-4 h-4 flex-shrink-0" style={{ color: '#34d399' }} />
          <div className="text-3xl font-extrabold leading-none tabular-nums" style={{ color: 'var(--text-1)', letterSpacing: '-0.04em' }}>
            {fmt(contactsSavedTotal ?? contacts.length)}
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Contatos</div>
        </div>
        <div
          className="flex flex-col gap-1.5 rounded-xl p-4 transition-all hover:-translate-y-1 cursor-pointer"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border-subtle)',
            borderTop: '2px solid #f472b6',
            boxShadow: 'var(--shadow-sm)',
          }}
          onClick={() => onNavigate('campaigns')}
        >
          <Rocket className="w-4 h-4 flex-shrink-0" style={{ color: '#f472b6' }} />
          <div className="text-3xl font-extrabold leading-none tabular-nums" style={{ color: 'var(--text-1)', letterSpacing: '-0.04em' }}>
            {campaigns.length}
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Campanhas</div>
        </div>
      </div>

      {/* ── Linha 3: mapa teaser ──────────────────────── */}
      <TerritoryMapTeaser
        contacts={contacts}
        contactsSavedTotal={contactsSavedTotal}
        onOpenMap={() => onNavigate('contacts-map')}
      />

      {/* ── Linha 4: nav pills ────────────────────────── */}
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
