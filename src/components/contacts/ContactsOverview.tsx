import React, { useMemo } from 'react';
import { Flame, MapPin, Church, Briefcase, MessageCircle, Activity, Rocket, Cake, Clock, Snowflake, Info, AlertCircle, Tag as TagIcon, Sparkles, TrendingUp } from 'lucide-react';
import type { Contact } from '../../types';
import { DonutChart, DonutLegend, BarList, MiniHeatmap, useDailyGrowth } from './ContactsVisuals';

type Temperature = 'hot' | 'warm' | 'cold' | 'new';

interface TempStats {
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  lastSentTs: number;
  lastReplyTs: number;
  lastReadTs: number;
  temp: Temperature;
  score: number;
}

interface ContactsOverviewProps {
  contacts: Contact[];
  contactTemps: Record<string, TempStats>;
  onOpenChat: (contact: Contact) => void;
  onNewCampaign: () => void;
  onGoToSegments: () => void;
  onGoToBirthdays: () => void;
}

const ContactsOverviewBase: React.FC<ContactsOverviewProps> = ({
  contacts,
  contactTemps,
  onOpenChat,
  onNewCampaign,
  onGoToSegments,
  onGoToBirthdays
}) => {
  const growth90d = useDailyGrowth(contacts, 91);
  const growth30d = useDailyGrowth(contacts, 30);

  // Temperatura donut
  const tempData = useMemo(() => {
    const counts: Record<Temperature, number> = { hot: 0, warm: 0, cold: 0, new: 0 };
    for (const c of contacts) {
      const t = contactTemps[c.id]?.temp || 'new';
      counts[t]++;
    }
    return [
      { id: 'hot', label: 'Quentes', value: counts.hot, color: '#f43f5e' },
      { id: 'warm', label: 'Mornos', value: counts.warm, color: '#f59e0b' },
      { id: 'cold', label: 'Frios', value: counts.cold, color: '#0ea5e9' },
      { id: 'new', label: 'Sem histórico', value: counts.new, color: '#94a3b8' }
    ];
  }, [contacts, contactTemps]);

  // Status donut
  const statusData = useMemo(() => {
    const valid = contacts.filter((c) => c.status === 'VALID').length;
    const invalid = contacts.length - valid;
    return [
      { id: 'valid', label: 'Válidos', value: valid, color: '#10b981' },
      { id: 'invalid', label: 'Inválidos', value: invalid, color: '#f43f5e' }
    ];
  }, [contacts]);

  // Top cidades
  const topCities = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of contacts) {
      const key = (c.city || '').trim();
      if (!key) continue;
      const label = c.state ? `${key} / ${c.state}` : key;
      map[label] = (map[label] || 0) + 1;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value], i) => ({
        id: label,
        label,
        value,
        accent:
          i === 0
            ? 'linear-gradient(90deg, rgba(16,185,129,0.9), rgba(16,185,129,0.6))'
            : 'linear-gradient(90deg, rgba(16,185,129,0.7), rgba(16,185,129,0.35))'
      }));
  }, [contacts]);

  // Top igrejas (nicho evangélico do produto)
  const topChurches = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of contacts) {
      const key = (c.church || '').trim();
      if (!key) continue;
      map[key] = (map[key] || 0) + 1;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value], i) => ({
        id: label,
        label,
        value,
        accent:
          i === 0
            ? 'linear-gradient(90deg, rgba(139,92,246,0.9), rgba(139,92,246,0.55))'
            : 'linear-gradient(90deg, rgba(139,92,246,0.65), rgba(139,92,246,0.3))'
      }));
  }, [contacts]);

  // Top profissões
  const topProfessions = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of contacts) {
      const key = (c.profession || '').trim();
      if (!key) continue;
      map[key] = (map[key] || 0) + 1;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value]) => ({
        id: label,
        label,
        value,
        accent: 'linear-gradient(90deg, rgba(14,165,233,0.8), rgba(14,165,233,0.4))'
      }));
  }, [contacts]);

  // Distribuição por UF
  const topStates = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of contacts) {
      const key = (c.state || '').trim().toUpperCase();
      if (!key) continue;
      map[key] = (map[key] || 0) + 1;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [contacts]);

  // Atividade recente (top 6)
  const recentActivity = useMemo(() => {
    return contacts
      .map((c) => {
        const t = contactTemps[c.id];
        const latest = t ? Math.max(t.lastReplyTs || 0, t.lastReadTs || 0, t.lastSentTs || 0) : 0;
        return { c, t, latest };
      })
      .filter((x) => x.latest > 0)
      .sort((a, b) => b.latest - a.latest)
      .slice(0, 6);
  }, [contacts, contactTemps]);

  const fmtAgo = (ms: number) => {
    const diff = Date.now() - ms;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `${min}min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d`;
    return `${Math.floor(d / 30)}m`;
  };

  const totalActive = contacts.length;
  const hotCount = tempData.find((t) => t.id === 'hot')?.value || 0;
  const warmCount = tempData.find((t) => t.id === 'warm')?.value || 0;
  const coldCount = tempData.find((t) => t.id === 'cold')?.value || 0;
  const newCount = tempData.find((t) => t.id === 'new')?.value || 0;
  const validCount = statusData.find((s) => s.id === 'valid')?.value || 0;
  const invalidCount = statusData.find((s) => s.id === 'invalid')?.value || 0;
  const growthLast7 = growth30d.slice(-7).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      {/* Linha 1: Donut temperatura + Donut status + Crescimento + Top cidades */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Donut temperatura */}
        <div className="ui-card p-5 lg:col-span-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                <Flame className="w-4 h-4 text-rose-500" /> Temperatura da base
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Engajamento por contato</p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total {totalActive}</span>
          </div>
          <div className="flex items-center gap-4">
            <DonutChart
              slices={tempData}
              size={140}
              thickness={20}
              centerTop={totalActive > 0 ? `${Math.round((hotCount / totalActive) * 100)}%` : '0%'}
              centerBottom="Quentes"
            />
            <div className="flex-1 min-w-0">
              <DonutLegend slices={tempData} total={totalActive} />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <p className="text-[11px] text-slate-500">
              {hotCount > 0 ? `${hotCount} contatos prontos para conversão` : 'Sem contatos quentes'}
            </p>
            {hotCount > 0 && (
              <button
                onClick={onNewCampaign}
                className="text-[11px] font-black text-emerald-600 dark:text-emerald-400 hover:underline"
              >
                Criar campanha →
              </button>
            )}
          </div>
        </div>

        {/* Donut Status */}
        <div className="ui-card p-5 lg:col-span-3">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                <Sparkles className="w-4 h-4 text-emerald-500" /> Saúde da base
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Validade dos telefones</p>
            </div>
          </div>
          <div className="flex flex-col items-center gap-3">
            <DonutChart
              slices={statusData}
              size={130}
              thickness={18}
              centerTop={totalActive > 0 ? `${Math.round((validCount / totalActive) * 100)}%` : '0%'}
              centerBottom="Válidos"
            />
            <div className="w-full">
              <DonutLegend slices={statusData} total={totalActive} />
            </div>
            {invalidCount > 0 && (
              <button
                onClick={onGoToSegments}
                className="w-full mt-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[11px] font-bold border border-rose-500/20 hover:bg-rose-500/15"
              >
                <AlertCircle className="w-3 h-3" /> Revisar {invalidCount} inválidos
              </button>
            )}
          </div>
        </div>

        {/* Crescimento 90d — heatmap */}
        <div className="ui-card p-5 lg:col-span-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                <TrendingUp className="w-4 h-4 text-sky-500" /> Crescimento da base
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Últimos 90 dias (cada quadrado = 1 dia)</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Últ. 7 dias</p>
              <p className="text-xl font-black tabular-nums text-emerald-600 dark:text-emerald-400 leading-none">
                +{growthLast7}
              </p>
            </div>
          </div>
          <div className="flex justify-center py-2">
            <MiniHeatmap days={growth90d} weeks={13} cellSize={13} gap={3} />
          </div>
          <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
            <span>Menos</span>
            <div className="flex items-center gap-1">
              {['rgba(148,163,184,0.15)', 'rgba(52,211,153,0.35)', 'rgba(52,211,153,0.6)', 'rgba(16,185,129,0.85)', 'rgba(5,150,105,1)'].map((c, i) => (
                <span key={i} className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />
              ))}
            </div>
            <span>Mais</span>
          </div>
        </div>
      </div>

      {/* Linha 2: Top cidades + Top igrejas + Top profissões */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="ui-card p-5 lg:col-span-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-emerald-500" /> Top cidades
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Onde sua audiência está concentrada</p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{topCities.length}</span>
          </div>
          <BarList items={topCities} emptyLabel="Nenhuma cidade cadastrada." />
        </div>

        <div className="ui-card p-5 lg:col-span-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                <Church className="w-4 h-4 text-violet-500" /> Top igrejas
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Distribuição por congregação</p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{topChurches.length}</span>
          </div>
          <BarList items={topChurches} emptyLabel="Nenhuma igreja cadastrada." />
        </div>

        <div className="ui-card p-5 lg:col-span-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                <Briefcase className="w-4 h-4 text-sky-500" /> Top profissões
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Para segmentação B2B</p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{topProfessions.length}</span>
          </div>
          <BarList items={topProfessions} emptyLabel="Nenhuma profissão cadastrada." />
        </div>
      </div>

      {/* Linha 3: Distribuição UF + Atividade recente + Atalhos */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* UFs */}
        <div className="ui-card p-5 lg:col-span-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-amber-500" /> Estados (UF)
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Cobertura geográfica</p>
            </div>
          </div>
          {topStates.length === 0 ? (
            <p className="text-[12px] text-slate-400 py-6 text-center">Nenhum estado cadastrado.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {topStates.map(([uf, count], i) => (
                <div
                  key={uf}
                  className={`text-center p-2 rounded-lg border ${
                    i === 0
                      ? 'bg-gradient-to-br from-amber-500/15 to-amber-500/5 border-amber-200 dark:border-amber-900/40 text-amber-700 dark:text-amber-300'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <p className="text-sm font-black tabular-nums">{uf}</p>
                  <p className="text-[10.5px] font-bold opacity-80 tabular-nums">{count}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Atividade recente */}
        <div className="ui-card p-5 lg:col-span-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2 text-sm">
                <Activity className="w-4 h-4 text-emerald-500" /> Atividade recente
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Últimas interações — clique para abrir</p>
            </div>
          </div>
          {recentActivity.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-8">
              <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-2">
                <MessageCircle className="w-5 h-5 text-slate-400" />
              </div>
              <p className="text-xs text-slate-500">Sem interações registradas ainda.</p>
              <button
                onClick={onNewCampaign}
                className="mt-3 text-[11px] font-black text-emerald-600 dark:text-emerald-400 hover:underline"
              >
                Criar primeira campanha →
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {recentActivity.map(({ c, t, latest }) => {
                const Icon = t?.temp === 'hot' ? Flame : t?.temp === 'warm' ? Flame : t?.temp === 'cold' ? Snowflake : Info;
                const color =
                  t?.temp === 'hot' ? 'text-rose-500'
                  : t?.temp === 'warm' ? 'text-amber-500'
                  : t?.temp === 'cold' ? 'text-sky-500'
                  : 'text-slate-400';
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onOpenChat(c)}
                    className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors group text-left"
                  >
                    <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-black text-xs shrink-0">
                      {c.name.charAt(0).toUpperCase() || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{c.name}</span>
                        {t && <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />}
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">
                        {t?.lastReplyTs === latest ? 'respondeu' : t?.lastReadTs === latest ? 'leu' : 'recebeu'} • há {fmtAgo(latest)}
                      </p>
                    </div>
                    <MessageCircle className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Atalhos */}
        <div className="ui-card p-5 lg:col-span-3 flex flex-col">
          <h3 className="font-black text-slate-900 dark:text-white flex items-center gap-2 text-sm mb-3">
            <Rocket className="w-4 h-4 text-emerald-500" /> Atalhos
          </h3>
          <div className="space-y-2 flex-1">
            <QuickAction
              icon={<Cake className="w-4 h-4" />}
              label="Aniversariantes"
              hint={`Próximos 7 dias`}
              onClick={onGoToBirthdays}
              accent="amber"
            />
            <QuickAction
              icon={<TagIcon className="w-4 h-4" />}
              label="Segmentos inteligentes"
              hint="Filtros prontos"
              onClick={onGoToSegments}
              accent="violet"
            />
            <QuickAction
              icon={<Rocket className="w-4 h-4" />}
              label="Nova campanha"
              hint="Para sua base toda"
              onClick={onNewCampaign}
              accent="emerald"
            />
          </div>
          {/* mini stats ambiente */}
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 gap-2 text-center">
            <div>
              <p className="text-[9.5px] font-black text-slate-400 uppercase tracking-wider">Mornos</p>
              <p className="text-sm font-black tabular-nums text-amber-600 dark:text-amber-400">{warmCount}</p>
            </div>
            <div>
              <p className="text-[9.5px] font-black text-slate-400 uppercase tracking-wider">Sem hist.</p>
              <p className="text-sm font-black tabular-nums text-slate-500">{newCount}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ContactsOverview = React.memo(ContactsOverviewBase);

const QuickAction: React.FC<{
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  accent: 'emerald' | 'amber' | 'violet';
}> = ({ icon, label, hint, onClick, accent }) => {
  const map: Record<string, string> = {
    emerald: 'from-emerald-500/15 to-emerald-500/5 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-900/40 hover:from-emerald-500/25 hover:to-emerald-500/10',
    amber:   'from-amber-500/15 to-amber-500/5 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-900/40 hover:from-amber-500/25 hover:to-amber-500/10',
    violet:  'from-violet-500/15 to-violet-500/5 text-violet-700 dark:text-violet-300 border-violet-200/60 dark:border-violet-900/40 hover:from-violet-500/25 hover:to-violet-500/10'
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg bg-gradient-to-br ${map[accent]} border transition-all group`}
    >
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0 flex-1 text-left">
        <p className="text-[12px] font-black leading-tight truncate">{label}</p>
        <p className="text-[10.5px] opacity-80 truncate">{hint}</p>
      </div>
      <span className="text-sm opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all">→</span>
    </button>
  );
};
