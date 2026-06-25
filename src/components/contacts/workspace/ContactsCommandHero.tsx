import React from 'react';
import {
  UserPlus, Upload, Download, Wand2, FileSpreadsheet, Smartphone,
  ChevronDown, SpellCheck2, BarChart3
} from 'lucide-react';

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
  /** Total salvo no banco — exibido enquanto os contatos ainda estão carregando. */
  savedTotal?: number | null;
  // Ações do header
  onNewContact: () => void;
  onImportXLSX: () => void;
  onImportVcf: () => void;
  onSmartImport: () => void;
  onDownloadTemplate: () => void;
  onExport: () => void;
  onOpenInsights: () => void;
  onOpenNormalizeNames?: () => void;
}

export const ContactsCommandHero: React.FC<Props> = React.memo(({
  stats,
  contactTempsReady,
  hideWedding = false,
  savedTotal,
  onNewContact, onImportXLSX, onImportVcf, onSmartImport,
  onDownloadTemplate, onExport, onOpenInsights,
  onOpenNormalizeNames
}) => {
  const [importOpen, setImportOpen] = React.useState(false);
  const importRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!importOpen) return;
    const close = (e: MouseEvent) => {
      if (importRef.current && !importRef.current.contains(e.target as Node)) setImportOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [importOpen]);

  const displayTotal = Math.max(stats.total, savedTotal ?? 0, 1);

  return (
    <div className="crm-fade-up flex flex-col gap-3">
      {/* Linha 1: ações (título fica no TopBar + faixa PageShell) */}
      <div className={`crm-topbar flex flex-col lg:flex-row lg:items-center lg:justify-end gap-4${importOpen ? ' crm-topbar--menu-open' : ''}`}>
        <div className="crm-topbar__actions flex items-center gap-2 flex-wrap w-full lg:w-auto lg:ml-auto">
          <button type="button" onClick={onOpenInsights} className="crm-btn" title="Insights e segmentos">
            <BarChart3 className="w-4 h-4" style={{ color: 'var(--brand-500)' }} />
            <span className="hidden sm:inline">Insights</span>
          </button>

          <div className="relative z-[70]" ref={importRef}>
            <button
              type="button"
              onClick={() => setImportOpen((v) => !v)}
              className={`crm-btn${importOpen ? ' crm-btn--active' : ''}`}
              aria-expanded={importOpen}
              aria-haspopup="menu"
            >
              <Upload className="w-4 h-4 text-emerald-500" />
              <span className="hidden sm:inline">Importar</span>
              <ChevronDown className={`w-3 h-3 opacity-50 transition-transform${importOpen ? ' rotate-180' : ''}`} />
            </button>
            {importOpen && (
              <div
                role="menu"
                className="crm-import-menu absolute right-0 top-full mt-2 w-72 rounded-2xl z-[100] overflow-hidden shadow-xl"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
              >
                <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ background: 'var(--surface-0)', color: 'var(--text-3, #94a3b8)', borderBottom: '1px solid var(--border)' }}>
                  Opções de importação
                </div>
                {[
                  { icon: <FileSpreadsheet className="w-5 h-5 text-emerald-500" />, title: 'Importar XLSX / CSV', sub: 'Planilha com colunas do template', fn: () => { setImportOpen(false); onImportXLSX(); } },
                  { icon: <Smartphone className="w-5 h-5 text-teal-500" />, title: 'Importar vCard (.vcf)', sub: 'Exportado do celular (Contatos)', fn: () => { setImportOpen(false); onImportVcf(); } },
                  { icon: <Wand2 className="w-5 h-5 text-violet-500" />, title: 'Importação inteligente', sub: 'Cole texto livre — IA extrai os dados', fn: () => { setImportOpen(false); onSmartImport(); } },
                ].map((item) => (
                  <button key={item.title} type="button" onClick={item.fn} className="w-full flex items-start gap-3 px-4 py-3 text-left transition" style={{ borderBottom: '1px solid var(--border)' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-0)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    {item.icon}
                    <div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{item.title}</div>
                      <div className="text-[11px]" style={{ color: 'var(--text-3, #94a3b8)' }}>{item.sub}</div>
                    </div>
                  </button>
                ))}
                <div className="p-2" style={{ background: 'var(--surface-0)' }}>
                  <button type="button" onClick={() => { setImportOpen(false); onDownloadTemplate(); }} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed text-xs font-bold transition" style={{ borderColor: 'var(--crm-border-strong)', color: 'var(--text-2, #64748b)' }}>
                    <Download className="w-3.5 h-3.5" /> Baixar template XLSX
                  </button>
                </div>
              </div>
            )}
          </div>

          <button type="button" onClick={onExport} className="crm-btn">
            <Download className="w-4 h-4 text-sky-500" />
            <span className="hidden sm:inline">Exportar</span>
          </button>

          {onOpenNormalizeNames && (
            <button type="button" onClick={onOpenNormalizeNames} className="crm-btn" title="Padronizar nomes da base">
              <SpellCheck2 className="w-4 h-4 text-cyan-500" />
              <span className="hidden md:inline">Limpar nomes</span>
            </button>
          )}

          <button type="button" onClick={onNewContact} className="crm-btn crm-btn-primary">
            <UserPlus className="w-4 h-4" />
            Novo contato
          </button>
        </div>
      </div>

      {/* Barra de temperatura */}
      {stats.total > 0 && (
        <div className="crm-temp-row crm-fade-up">
          <span className="text-[10px] font-bold uppercase tracking-widest shrink-0" style={{ color: 'var(--text-3, #94a3b8)' }}>
            Temperatura
          </span>
          <div className="crm-temp-bar">
            {contactTempsReady ? (
              <>
                {stats.hot > 0 && <div className="crm-temp-seg" style={{ width: `${(stats.hot / displayTotal) * 100}%`, background: '#ef4444' }} />}
                {stats.warm > 0 && <div className="crm-temp-seg" style={{ width: `${(stats.warm / displayTotal) * 100}%`, background: '#f59e0b' }} />}
                {stats.cold > 0 && <div className="crm-temp-seg" style={{ width: `${(stats.cold / displayTotal) * 100}%`, background: '#06b6d4' }} />}
              </>
            ) : (
              <div className="crm-temp-seg animate-pulse" style={{ width: '100%', background: 'var(--border)' }} />
            )}
          </div>
          <span className="text-[11px] font-semibold shrink-0" style={{ color: 'var(--text-2, #64748b)' }}>
            {contactTempsReady
              ? `🔥 ${stats.hot} · 🌡️ ${stats.warm} · ❄️ ${stats.cold}`
              : 'calculando…'}
          </span>
        </div>
      )}
    </div>
  );
});

ContactsCommandHero.displayName = 'ContactsCommandHero';
