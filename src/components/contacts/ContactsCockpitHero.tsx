import React from 'react';
import { Users, Flame, Cake, Clock, TrendingUp, CheckCircle2, Sparkles, UserPlus, Upload, Wand2, FileSpreadsheet, Download } from 'lucide-react';
import { Sparkline } from './ContactsVisuals';

export interface ContactsHeroStats {
  total: number;
  valid: number;
  invalid: number;
  hot: number;
  warm: number;
  cold: number;
  newOnes: number;
  dormant: number;
  bdayToday: number;
  bdayWeek: number;
  addressPct: number;
  last7: number;
  duplicates: number;
  /** série diária dos últimos 30 dias (count de contatos criados) */
  growth30d: number[];
}

interface Props {
  stats: ContactsHeroStats;
  onNewContact: () => void;
  onImportXLSX: () => void;
  onSmartImport: () => void;
  onDownloadTemplate: () => void;
  onExport: () => void;
}

const miniFormat = (n: number): string => {
  if (n >= 10000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k`;
  return n.toLocaleString('pt-BR');
};

const ContactsCockpitHeroBase: React.FC<Props> = ({
  stats,
  onNewContact,
  onImportXLSX,
  onSmartImport,
  onDownloadTemplate,
  onExport
}) => {
  const growthSum = stats.growth30d.reduce((a, b) => a + b, 0);
  const growthTrend = (() => {
    const recent = stats.growth30d.slice(-7).reduce((a, b) => a + b, 0);
    const prev = stats.growth30d.slice(-14, -7).reduce((a, b) => a + b, 0);
    if (prev === 0 && recent === 0) return { label: 'estável', tone: 'text-slate-400' };
    if (prev === 0) return { label: '+novo', tone: 'text-emerald-500' };
    const delta = Math.round(((recent - prev) / prev) * 100);
    if (delta > 0) return { label: `+${delta}% vs semana anterior`, tone: 'text-emerald-500' };
    if (delta < 0) return { label: `${delta}% vs semana anterior`, tone: 'text-rose-500' };
    return { label: 'sem variação', tone: 'text-slate-400' };
  })();

  const validPct = stats.total === 0 ? 0 : Math.round((stats.valid / stats.total) * 100);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-white via-white to-emerald-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-emerald-950/20 shadow-sm">
      {/* Orbs decorativos */}
      <div aria-hidden className="absolute -top-24 -right-20 w-72 h-72 rounded-full pointer-events-none opacity-60"
        style={{ background: 'radial-gradient(closest-side, rgba(16,185,129,0.35), transparent 70%)' }}
      />
      <div aria-hidden className="absolute -bottom-32 -left-16 w-80 h-80 rounded-full pointer-events-none opacity-50"
        style={{ background: 'radial-gradient(closest-side, rgba(139,92,246,0.28), transparent 70%)' }}
      />
      <div aria-hidden className="absolute inset-0 pointer-events-none opacity-[0.05] dark:opacity-[0.08]"
        style={{
          backgroundImage: 'linear-gradient(rgba(100,116,139,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(100,116,139,0.5) 1px, transparent 1px)',
          backgroundSize: '32px 32px'
        }}
      />

      <div className="relative p-5 md:p-6">
        {/* Cabeçalho com eyebrow, título e ações */}
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-widest">
              <Users className="w-3 h-3" /> Central de Contatos
            </div>
            <h1 className="mt-2 text-2xl md:text-[28px] font-black text-slate-900 dark:text-white tracking-tight leading-tight">
              Sua audiência,{' '}
              <span className="bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500 bg-clip-text text-transparent">
                no controle total
              </span>
            </h1>
            <p className="text-[13px] text-slate-600 dark:text-slate-400 mt-1.5 max-w-2xl">
              Segmente com inteligência, acompanhe crescimento e dispare campanhas direto da base — tudo em um só lugar.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={onDownloadTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors"
              title="Baixar modelo de planilha"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" /> Modelo
            </button>
            <button
              type="button"
              onClick={onExport}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors"
              title="Exportar toda a base"
            >
              <Download className="w-3.5 h-3.5" /> Exportar
            </button>
            <button
              type="button"
              onClick={onImportXLSX}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" /> Importar XLSX
            </button>
            <button
              type="button"
              onClick={onSmartImport}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-br from-violet-500/10 to-violet-500/5 border border-violet-300/60 dark:border-violet-800/60 text-violet-700 dark:text-violet-300 text-xs font-bold hover:from-violet-500/20 hover:to-violet-500/10 transition-all"
            >
              <Wand2 className="w-3.5 h-3.5" /> Colar do Excel/Word
            </button>
            <button
              type="button"
              onClick={onNewContact}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white text-xs font-black shadow-md shadow-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/30 transition-all"
            >
              <UserPlus className="w-3.5 h-3.5" /> Novo contato
            </button>
          </div>
        </div>

        {/* Bento Grid — hero KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          {/* Big card: Base total + growth */}
          <div className="md:col-span-3 relative overflow-hidden rounded-xl border border-emerald-200/60 dark:border-emerald-900/40 bg-white dark:bg-slate-900 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Base total</p>
                <p className="text-4xl md:text-5xl font-black tabular-nums text-slate-900 dark:text-white leading-none mt-1.5">
                  {miniFormat(stats.total)}
                </p>
                <div className="mt-2.5 flex items-center gap-3 flex-wrap">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold">
                    <TrendingUp className="w-3 h-3" />
                    +{growthSum} em 30d
                  </span>
                  <span className={`text-[11px] font-semibold ${growthTrend.tone}`}>{growthTrend.label}</span>
                </div>
              </div>
              <div className="shrink-0 hidden sm:block">
                <Sparkline
                  values={stats.growth30d.length > 1 ? stats.growth30d : [0, 0]}
                  width={150}
                  height={52}
                  color="#10b981"
                  fill="rgba(16,185,129,0.18)"
                />
                <p className="text-[9.5px] text-slate-400 text-right mt-0.5 font-semibold">Últimos 30 dias</p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-3 gap-2">
              <MiniStat label="Válidos" value={stats.valid} sub={`${validPct}%`} accent="emerald" />
              <MiniStat label="Novos 7d" value={stats.last7} sub="semana" accent="sky" />
              <MiniStat label="Duplicados" value={stats.duplicates} sub="revisar" accent={stats.duplicates > 0 ? 'amber' : 'slate'} />
            </div>
          </div>

          {/* Temperature pill */}
          <HeroKPI
            label="Quentes"
            value={stats.hot}
            hint={`${stats.warm} mornos • ${stats.cold} frios`}
            accent="rose"
            icon={<Flame className="w-4 h-4" />}
          />
          <HeroKPI
            label="Aniversários 7d"
            value={stats.bdayWeek}
            hint={stats.bdayToday > 0 ? `${stats.bdayToday} é hoje!` : 'Próximos 7 dias'}
            accent="amber"
            icon={<Cake className="w-4 h-4" />}
          />
          <HeroKPI
            label="Dormentes"
            value={stats.dormant}
            hint="Sem resposta > 30d"
            accent="violet"
            icon={<Clock className="w-4 h-4" />}
          />
          <HeroKPI
            label="Completude"
            value={`${stats.addressPct}%`}
            hint={stats.invalid > 0 ? `${stats.invalid} inválidos` : 'Endereço completo'}
            accent={stats.addressPct >= 70 ? 'emerald' : stats.addressPct >= 40 ? 'amber' : 'rose'}
            icon={<CheckCircle2 className="w-4 h-4" />}
          />
        </div>

        {/* Dica contextual inteligente — rotaciona com base no dado mais relevante */}
        <HeroCoach stats={stats} />
      </div>
    </div>
  );
};

export const ContactsCockpitHero = React.memo(ContactsCockpitHeroBase);

interface MiniStatProps {
  label: string;
  value: number;
  sub?: string;
  accent: 'emerald' | 'amber' | 'rose' | 'sky' | 'slate';
}
const MiniStat: React.FC<MiniStatProps> = ({ label, value, sub, accent }) => {
  const map: Record<MiniStatProps['accent'], string> = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    rose: 'text-rose-600 dark:text-rose-400',
    sky: 'text-sky-600 dark:text-sky-400',
    slate: 'text-slate-500 dark:text-slate-400'
  };
  return (
    <div>
      <p className="text-[9.5px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="text-base font-black tabular-nums text-slate-900 dark:text-white leading-tight mt-0.5">{value}</p>
      {sub && <p className={`text-[10px] font-bold ${map[accent]}`}>{sub}</p>}
    </div>
  );
};

interface HeroKPIProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent: 'emerald' | 'amber' | 'rose' | 'sky' | 'violet';
  icon?: React.ReactNode;
}
const HeroKPI: React.FC<HeroKPIProps> = ({ label, value, hint, accent, icon }) => {
  const accentMap: Record<HeroKPIProps['accent'], { bg: string; fg: string; border: string; chip: string }> = {
    emerald: { bg: 'from-emerald-500/15 to-emerald-500/5', fg: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200/60 dark:border-emerald-900/40', chip: 'bg-emerald-500/10' },
    amber:   { bg: 'from-amber-500/15 to-amber-500/5',     fg: 'text-amber-600 dark:text-amber-400',     border: 'border-amber-200/60 dark:border-amber-900/40',     chip: 'bg-amber-500/10' },
    rose:    { bg: 'from-rose-500/15 to-rose-500/5',       fg: 'text-rose-600 dark:text-rose-400',       border: 'border-rose-200/60 dark:border-rose-900/40',       chip: 'bg-rose-500/10' },
    sky:     { bg: 'from-sky-500/15 to-sky-500/5',         fg: 'text-sky-600 dark:text-sky-400',         border: 'border-sky-200/60 dark:border-sky-900/40',         chip: 'bg-sky-500/10' },
    violet:  { bg: 'from-violet-500/15 to-violet-500/5',   fg: 'text-violet-600 dark:text-violet-400',   border: 'border-violet-200/60 dark:border-violet-900/40',   chip: 'bg-violet-500/10' }
  };
  const a = accentMap[accent];
  return (
    <div className={`relative overflow-hidden rounded-xl border ${a.border} bg-gradient-to-br ${a.bg} p-3 md:col-span-1`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 leading-tight">{label}</p>
        {icon && <div className={`p-1 rounded-lg ${a.chip} ${a.fg}`}>{icon}</div>}
      </div>
      <p className="text-2xl md:text-[28px] font-black tabular-nums text-slate-900 dark:text-white leading-none mt-2">{value}</p>
      {hint && <p className={`text-[10.5px] font-bold mt-1 truncate ${a.fg}`}>{hint}</p>}
    </div>
  );
};

/** Coach: olha os dados e mostra a sugestão mais impactante. */
const HeroCoach: React.FC<{ stats: ContactsHeroStats }> = ({ stats }) => {
  let tip: { icon: React.ReactNode; text: string; tone: string } | null = null;

  if (stats.total === 0) {
    tip = {
      icon: <Sparkles className="w-3.5 h-3.5" />,
      text: 'Comece importando sua base ou cadastrando os primeiros contatos — em menos de 1 minuto dá pra começar a disparar.',
      tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
    };
  } else if (stats.bdayToday > 0) {
    tip = {
      icon: <Cake className="w-3.5 h-3.5" />,
      text: `${stats.bdayToday} contato${stats.bdayToday > 1 ? 's fazem' : ' faz'} aniversário HOJE — vá em "Aniversariantes" e parabenize de uma vez só.`,
      tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
    };
  } else if (stats.duplicates > 5) {
    tip = {
      icon: <Users className="w-3.5 h-3.5" />,
      text: `Existem ${stats.duplicates} contatos duplicados. Use o segmento "Duplicados" para limpar sua base.`,
      tone: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30'
    };
  } else if (stats.dormant > 10) {
    tip = {
      icon: <Clock className="w-3.5 h-3.5" />,
      text: `${stats.dormant} contatos estão dormentes (sem resposta há mais de 30 dias). Dispare uma campanha de reativação.`,
      tone: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30'
    };
  } else if (stats.invalid > 0 && stats.total > 0 && stats.invalid / stats.total > 0.1) {
    tip = {
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      text: `${Math.round((stats.invalid / stats.total) * 100)}% da base tem telefone inválido. Filtre pelo segmento "Inválidos" e corrija antes do próximo disparo.`,
      tone: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30'
    };
  } else if (stats.addressPct < 40 && stats.total > 10) {
    tip = {
      icon: <TrendingUp className="w-3.5 h-3.5" />,
      text: `Apenas ${stats.addressPct}% dos contatos têm endereço completo. Base enriquecida rende campanhas mais personalizadas.`,
      tone: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30'
    };
  } else if (stats.hot > 0) {
    tip = {
      icon: <Flame className="w-3.5 h-3.5" />,
      text: `Você tem ${stats.hot} contatos QUENTES agora. Aproveite o momento e crie uma campanha de conversão.`,
      tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
    };
  }

  if (!tip) return null;
  return (
    <div className={`mt-4 inline-flex items-start gap-2 px-3 py-2 rounded-lg border ${tip.tone}`}>
      <span className="mt-0.5 shrink-0">{tip.icon}</span>
      <p className="text-[12px] font-semibold leading-snug">{tip.text}</p>
    </div>
  );
};
