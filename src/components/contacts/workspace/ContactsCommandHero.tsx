import React from 'react';
import { Users, Flame, TrendingUp, Clock, Cake, Heart, Database, Sparkles } from 'lucide-react';

export interface ContactsCommandHeroStats {
  total: number;
  hot: number;
  warm: number;
  cold: number;
  last7: number;
  retorno_hoje: number;
  bdayToday: number;
  weddingWeek: number;
}

interface Props {
  stats: ContactsCommandHeroStats;
  contactTempsReady: boolean;
  hideWedding?: boolean;
}

interface KpiDef {
  label: string;
  getVal: (s: ContactsCommandHeroStats) => string;
  color: string;
  icon: React.ReactNode;
  tempDependent?: boolean;
}

const KPIS: KpiDef[] = [
  { label: 'Total', getVal: (s) => s.total.toLocaleString('pt-BR'), color: '#60a5fa', icon: <Users className="w-3.5 h-3.5" /> },
  { label: 'Quentes', getVal: (s) => s.hot.toLocaleString('pt-BR'), color: '#f87171', icon: <Flame className="w-3.5 h-3.5" />, tempDependent: true },
  { label: 'Novos (7d)', getVal: (s) => s.last7.toLocaleString('pt-BR'), color: '#34d399', icon: <TrendingUp className="w-3.5 h-3.5" /> },
  { label: 'Retorno hoje', getVal: (s) => s.retorno_hoje.toLocaleString('pt-BR'), color: '#fbbf24', icon: <Clock className="w-3.5 h-3.5" /> },
  { label: 'Aniv. hoje', getVal: (s) => s.bdayToday.toLocaleString('pt-BR'), color: '#e879f9', icon: <Cake className="w-3.5 h-3.5" /> },
  { label: 'Casamentos 7d', getVal: (s) => s.weddingWeek.toLocaleString('pt-BR'), color: '#f9a8d4', icon: <Heart className="w-3.5 h-3.5" /> }
];

export const ContactsCommandHero: React.FC<Props> = React.memo(({ stats, contactTempsReady, hideWedding = false }) => {
  if (stats.total <= 0) return null;

  const kpis = hideWedding ? KPIS.filter((k) => k.label !== 'Casamentos 7d') : KPIS;
  const total = Math.max(stats.total, 1);

  return (
    <section className="zm-contacts-hero zm-contacts-section" aria-label="Painel de audiência">
      <div className="zm-contacts-hero-accent" aria-hidden />
      <div className="zm-contacts-hero-body">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg,#06B6D4,#10B981)', boxShadow: '0 8px 22px -8px rgba(16,185,129,0.65)' }}
          >
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-sky-400/80">Audience Command</p>
            <h2 className="text-lg sm:text-xl font-black text-white tracking-tight leading-tight">Sua base em tempo real</h2>
          </div>
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold shrink-0"
            style={{ background: 'rgba(59,130,246,0.15)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.3)' }}
          >
            <Database className="w-3 h-3" />
            {stats.total.toLocaleString('pt-BR')} contatos
          </span>
        </div>

        <div className={`grid gap-2 ${kpis.length >= 6 ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'}`}>
          {kpis.map((k) => (
            <div key={k.label} className="zm-contacts-kpi" style={{ background: `${k.color}12`, borderColor: `${k.color}30` }}>
              <div className="zm-contacts-kpi-label">
                <span style={{ color: k.color }}>{k.icon}</span>
                {k.label}
              </div>
              {k.tempDependent && !contactTempsReady ? (
                <span className="text-sm font-semibold animate-pulse" style={{ color: 'rgba(255,255,255,0.35)' }}>…</span>
              ) : (
                <span className="zm-contacts-kpi-value">{k.getVal(stats)}</span>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 pt-1">
          <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Temperatura da base
            </span>
            <span className="text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {contactTempsReady ? <>🔥 {stats.hot} · 🌡️ {stats.warm} · ❄️ {stats.cold}</> : 'calculando…'}
            </span>
          </div>
          {contactTempsReady ? (
            <div className="zm-contacts-temp-bar">
              {stats.hot > 0 && (
                <div className="zm-contacts-temp-seg" style={{ width: `${Math.max((stats.hot / total) * 100, 0.5)}%`, background: 'linear-gradient(90deg,#ef4444,#f97316)' }} />
              )}
              {stats.warm > 0 && (
                <div className="zm-contacts-temp-seg" style={{ width: `${Math.max((stats.warm / total) * 100, 0.5)}%`, background: 'linear-gradient(90deg,#f59e0b,#fbbf24)' }} />
              )}
              {stats.cold > 0 && (
                <div className="zm-contacts-temp-seg" style={{ width: `${Math.max((stats.cold / total) * 100, 0.5)}%`, background: 'linear-gradient(90deg,#06B6D4,#22d3ee)' }} />
              )}
            </div>
          ) : (
            <div className="zm-contacts-temp-bar animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
          )}
        </div>
      </div>
    </section>
  );
});

ContactsCommandHero.displayName = 'ContactsCommandHero';
