import React from 'react';
import { Users, UserPlus, Upload, Download, BarChart3, FileSpreadsheet, Wand2, ChevronDown, Smartphone, SpellCheck2, MapPin } from 'lucide-react';

interface HeaderStats {
  total: number;
  valid: number;
  newLast7: number;
  hot: number;
  bdayToday: number;
  /** Contatos com bodas nos próximos 7 dias (data na ficha). */
  weddingWeek: number;
}

interface Props {
  stats: HeaderStats;
  /** Segmento religioso: não mostrar pill de bodas na barra (bodas ficam só na ficha). */
  hideWeddingWeekPill?: boolean;
  onNewContact: () => void;
  onImportXLSX: () => void;
  onImportVcf: () => void;
  onSmartImport: () => void;
  onDownloadTemplate: () => void;
  onExport: () => void;
  onOpenInsights: () => void;
  /** Padronizar / limpar nomes na base inteira (modal na aba Contatos). */
  onOpenNormalizeNames?: () => void;
  /** Padronizar cidade/UF/bairro/CEP na base inteira. */
  onOpenNormalizeAddresses?: () => void;
  addressNormalizeBusy?: boolean;
  /** false enquanto o cálculo de temperatura ainda não terminou */
  contactTempsReady?: boolean;
}

/**
 * Header super enxuto da aba Contatos.
 * - Esquerda: título + contador grande + mini badges rápidos.
 * - Direita: ações primárias.
 * SEM sparklines, SEM animações custosas, SEM grids pesados. Carga instantânea.
 */
export const ContactsHeaderBar: React.FC<Props> = React.memo(({
  stats,
  hideWeddingWeekPill = false,
  onNewContact,
  onImportXLSX,
  onImportVcf,
  onSmartImport,
  onDownloadTemplate,
  onExport,
  onOpenInsights,
  onOpenNormalizeNames,
  onOpenNormalizeAddresses,
  addressNormalizeBusy = false,
  contactTempsReady = true
}) => {
  const [importOpen, setImportOpen] = React.useState(false);
  const importBtnRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!importOpen) return;
    const onClickAway = (e: MouseEvent) => {
      if (importBtnRef.current && !importBtnRef.current.contains(e.target as Node)) setImportOpen(false);
    };
    window.addEventListener('mousedown', onClickAway);
    return () => window.removeEventListener('mousedown', onClickAway);
  }, [importOpen]);

  return (
    <div className="ui-card px-5 py-4 flex flex-col lg:flex-row gap-5 lg:items-center lg:justify-between shadow-sm relative overflow-visible">
      {/* Background Decor */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-slate-100/50 dark:bg-slate-800/20 rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none" />
      
      {/* Esquerda — identidade + mini stats */}
      <div className="flex items-center gap-4 min-w-0 relative z-10">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center text-white shrink-0 shadow-lg"
          style={{ background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' }}
        >
          <Users className="w-6 h-6" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">Contatos</h1>
            <div
              className="px-2.5 py-1 rounded-lg text-xs font-black bg-slate-900 dark:bg-white dark:text-slate-900 text-white shadow-sm"
              title="Total de contatos na base"
            >
              {stats.total.toLocaleString('pt-BR')}
            </div>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-x-4 gap-y-2 flex-wrap mt-1.5">
            <Pill label="Válidos" value={stats.valid} tone="emerald" />
            <Pill label="Novos (7d)" value={stats.newLast7} tone="sky" />
            {contactTempsReady
              ? <Pill label="Quentes" value={stats.hot} tone="rose" />
              : <PillLoading label="Quentes" tone="rose" />
            }
            {stats.bdayToday > 0 && <Pill label="Aniver. hoje" value={stats.bdayToday} tone="amber" pulse />}
            {!hideWeddingWeekPill && stats.weddingWeek > 0 && (
              <Pill label="Bodas 7d" value={stats.weddingWeek} tone="rose" />
            )}
          </div>
        </div>
      </div>

      {/* Direita — ações */}
      <div className="flex items-center gap-2.5 flex-wrap relative z-10">
        <button
          onClick={onOpenInsights}
          className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-[var(--brand-500)]/50 hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-sm"
          title="Ver painel completo de análise (carrega sob demanda)"
        >
          <BarChart3 className="w-4 h-4 text-[var(--brand-500)]" />
          <span className="hidden sm:inline">Insights</span>
        </button>

        <div className="relative" ref={importBtnRef}>
          <button
            onClick={() => setImportOpen((v) => !v)}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-[var(--brand-500)]/50 hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-sm"
          >
            <Upload className="w-4 h-4 text-emerald-500" />
            <span className="hidden sm:inline">Importar</span>
            <ChevronDown className="w-3.5 h-3.5 opacity-60" />
          </button>
          {importOpen && (
            <div className="absolute right-0 top-full mt-2 w-72 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 z-[100] overflow-hidden ring-4 ring-black/5">
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Opções de entrada
              </div>
              <MenuItem
                icon={<FileSpreadsheet className="w-5 h-5 text-emerald-500" />}
                title="Importar XLSX / CSV"
                subtitle="Planilha com as colunas do template"
                onClick={() => { setImportOpen(false); onImportXLSX(); }}
              />
              <MenuItem
                icon={<Smartphone className="w-5 h-5 text-teal-500" />}
                title="Importar vCard (.vcf)"
                subtitle="Exportado do celular (Contatos)"
                onClick={() => { setImportOpen(false); onImportVcf(); }}
              />
              <MenuItem
                icon={<Wand2 className="w-5 h-5 text-cyan-500" />}
                title="Importação inteligente"
                subtitle="Cole texto livre — a IA extrai os dados"
                onClick={() => { setImportOpen(false); onSmartImport(); }}
              />
              <div className="p-2 bg-slate-50 dark:bg-slate-800/30">
                <button
                  onClick={() => { setImportOpen(false); onDownloadTemplate(); }}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  Baixar template XLSX
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={onExport}
          className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-[var(--brand-500)]/50 hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-sm"
        >
          <Download className="w-4 h-4 text-sky-500" />
          <span className="hidden sm:inline">Exportar</span>
        </button>

        {onOpenNormalizeNames && (
          <button
            type="button"
            onClick={onOpenNormalizeNames}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-[var(--brand-500)]/50 hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-sm"
            title="Remover prefixos, padronizar maiúsculas e opcionalmente reduzir a primeiro e último nome"
          >
            <SpellCheck2 className="w-4 h-4 text-cyan-500" />
            <span className="hidden sm:inline">Limpar nomes</span>
          </button>
        )}

        {onOpenNormalizeAddresses && (
          <button
            type="button"
            onClick={onOpenNormalizeAddresses}
            disabled={addressNormalizeBusy}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-[var(--brand-500)]/50 hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-sm disabled:opacity-60"
            title='Unifica "BLUMENAU - SC" → Blumenau + SC; corrige maiúsculas e UF pelo DDD'
          >
            <MapPin className={`w-4 h-4 text-rose-500 ${addressNormalizeBusy ? 'animate-pulse' : ''}`} />
            <span className="hidden sm:inline">{addressNormalizeBusy ? 'Padronizando…' : 'Padronizar cidades'}</span>
          </button>
        )}

        <button
          onClick={onNewContact}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white shadow-lg transition hover:scale-[1.02] active:scale-[0.98] hover:brightness-110 active:brightness-90"
          style={{ background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' }}
        >
          <UserPlus className="w-4 h-4" />
          <span>Novo contato</span>
        </button>
      </div>
    </div>
  );
});
ContactsHeaderBar.displayName = 'ContactsHeaderBar';

const Pill: React.FC<{ label: string; value: number; tone: 'emerald' | 'sky' | 'rose' | 'amber'; pulse?: boolean }> = ({ label, value, tone, pulse }) => {
  const toneMap: Record<typeof tone, string> = {
    emerald: 'text-emerald-600 dark:text-emerald-300',
    sky: 'text-sky-600 dark:text-sky-300',
    rose: 'text-rose-600 dark:text-rose-300',
    amber: 'text-amber-600 dark:text-amber-300'
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 ${pulse ? 'animate-pulse' : ''}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${pulse ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
      <span className={`font-semibold ${toneMap[tone]}`}>{value.toLocaleString('pt-BR')}</span>
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
    </span>
  );
};

const PillLoading: React.FC<{ label: string; tone: 'emerald' | 'sky' | 'rose' | 'amber' }> = ({ label, tone }) => {
  const toneMap: Record<typeof tone, string> = {
    emerald: 'text-emerald-600 dark:text-emerald-300',
    sky: 'text-sky-600 dark:text-sky-300',
    rose: 'text-rose-600 dark:text-rose-300',
    amber: 'text-amber-600 dark:text-amber-300'
  } as const;
  return (
    <span className="inline-flex items-center gap-1 animate-pulse">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
      <span className={`font-semibold ${toneMap[tone]}`}>…</span>
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
    </span>
  );
};

const MenuItem: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}> = ({ icon, title, subtitle, onClick }) => (
  <button
    onClick={onClick}
    className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-left"
  >
    <div className="mt-0.5">{icon}</div>
    <div>
      <div className="text-sm font-semibold text-slate-900 dark:text-white">{title}</div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</div>
    </div>
  </button>
);
