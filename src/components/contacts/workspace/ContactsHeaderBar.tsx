import React from 'react';
import { Users, UserPlus, Upload, Download, BarChart3, FileSpreadsheet, Wand2, ChevronDown, Smartphone } from 'lucide-react';

interface HeaderStats {
  total: number;
  valid: number;
  newLast7: number;
  hot: number;
  bdayToday: number;
}

interface Props {
  stats: HeaderStats;
  onNewContact: () => void;
  onImportXLSX: () => void;
  onImportVcf: () => void;
  onSmartImport: () => void;
  onDownloadTemplate: () => void;
  onExport: () => void;
  onOpenInsights: () => void;
}

/**
 * Header super enxuto da aba Contatos.
 * - Esquerda: título + contador grande + mini badges rápidos.
 * - Direita: ações primárias.
 * SEM sparklines, SEM animações custosas, SEM grids pesados. Carga instantânea.
 */
export const ContactsHeaderBar: React.FC<Props> = React.memo(({
  stats,
  onNewContact,
  onImportXLSX,
  onImportVcf,
  onSmartImport,
  onDownloadTemplate,
  onExport,
  onOpenInsights
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
    <div className="ui-card px-4 py-3 flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
      {/* Esquerda — identidade + mini stats */}
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 shadow"
          style={{ background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' }}
        >
          <Users className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">Contatos</h1>
            <span
              className="px-2 py-0.5 rounded-md text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
              title="Total de contatos na base"
            >
              {stats.total.toLocaleString('pt-BR')}
            </span>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap mt-0.5">
            <Pill label="Válidos" value={stats.valid} tone="emerald" />
            <Pill label="Novos (7d)" value={stats.newLast7} tone="sky" />
            <Pill label="Quentes" value={stats.hot} tone="rose" />
            {stats.bdayToday > 0 && <Pill label="Aniver. hoje" value={stats.bdayToday} tone="amber" pulse />}
          </div>
        </div>
      </div>

      {/* Direita — ações */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onOpenInsights}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
          title="Ver painel completo de análise (carrega sob demanda)"
        >
          <BarChart3 className="w-4 h-4" />
          <span className="hidden sm:inline">Insights</span>
        </button>

        <div className="relative" ref={importBtnRef}>
          <button
            onClick={() => setImportOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Importar</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>
          {importOpen && (
            <div className="absolute right-0 top-full mt-1 w-64 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 z-30 overflow-hidden">
              <MenuItem
                icon={<FileSpreadsheet className="w-4 h-4 text-emerald-500" />}
                title="Importar XLSX / CSV"
                subtitle="Planilha com as colunas do template"
                onClick={() => { setImportOpen(false); onImportXLSX(); }}
              />
              <MenuItem
                icon={<Smartphone className="w-4 h-4 text-teal-500" />}
                title="Importar vCard (.vcf)"
                subtitle="Exportado do celular (Contactos ou Android)"
                onClick={() => { setImportOpen(false); onImportVcf(); }}
              />
              <MenuItem
                icon={<Wand2 className="w-4 h-4 text-violet-500" />}
                title="Importação inteligente"
                subtitle="Cole texto livre — a IA extrai os dados"
                onClick={() => { setImportOpen(false); onSmartImport(); }}
              />
              <MenuItem
                icon={<Download className="w-4 h-4 text-sky-500" />}
                title="Baixar template"
                subtitle="Modelo XLSX pronto para preencher"
                onClick={() => { setImportOpen(false); onDownloadTemplate(); }}
              />
            </div>
          )}
        </div>

        <button
          onClick={onExport}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">Exportar</span>
        </button>

        <button
          onClick={onNewContact}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold text-white shadow-md transition hover:brightness-110"
          style={{ background: 'linear-gradient(135deg, var(--brand-500), var(--brand-700))' }}
        >
          <UserPlus className="w-4 h-4" />
          Novo contato
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
