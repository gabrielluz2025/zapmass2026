import React from 'react';
import {
  Users, Flame, TrendingUp, Clock, Cake, Heart,
  UserPlus, Upload, Download, Wand2, FileSpreadsheet, Smartphone,
  ChevronDown, SpellCheck2, MapPin, BarChart3
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
  /** Total salvo no banco â€” exibido enquanto os contatos ainda estÃ£o carregando. */
  savedTotal?: number | null;
  // AÃ§Ãµes do header
  onNewContact: () => void;
  onImportXLSX: () => void;
  onImportVcf: () => void;
  onSmartImport: () => void;
  onDownloadTemplate: () => void;
  onExport: () => void;
  onOpenInsights: () => void;
  onOpenNormalizeNames?: () => void;
  onOpenNormalizeAddresses?: () => void;
  addressNormalizeBusy?: boolean;
}

const fmt = (n: number) =>
  n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : n.toLocaleString('pt-BR');

export const ContactsCommandHero: React.FC<Props> = React.memo(({
  stats,
  contactTempsReady,
  hideWedding = false,
  savedTotal,
  onNewContact, onImportXLSX, onImportVcf, onSmartImport,
  onDownloadTemplate, onExport, onOpenInsights,
  onOpenNormalizeNames, onOpenNormalizeAddresses, addressNormalizeBusy = false
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

  const total = Math.max(stats.total, 1);

  const kpis = [
    { label: 'Total', value: fmt(stats.total), accent: '#6366f1', icon: <Users className="w-3.5 h-3.5" /> },
    { label: 'Quentes', value: contactTempsReady ? fmt(stats.hot) : 'â€¦', accent: '#ef4444', icon: <Flame className="w-3.5 h-3.5" />, pulse: !contactTempsReady },
    { label: 'Novos (7d)', value: fmt(stats.last7), accent: '#10b981', icon: <TrendingUp className="w-3.5 h-3.5" /> },
    { label: 'Retorno hoje', value: fmt(stats.retorno_hoje), accent: '#f59e0b', icon: <Clock className="w-3.5 h-3.5" /> },
    { label: 'Aniv. hoje', value: fmt(stats.bdayToday), accent: '#a855f7', icon: <Cake className="w-3.5 h-3.5" /> },
    ...(!hideWedding ? [{ label: 'Casamentos 7d', value: fmt(stats.weddingWeek), accent: '#ec4899', icon: <Heart className="w-3.5 h-3.5" /> }] : []),
  ];

  return (
    <div className="crm-fade-up flex flex-col gap-3">
      {/* â”€â”€ Linha 1: tÃ­tulo + aÃ§Ãµes â”€â”€ */}
      <div className="crm-topbar flex flex-col lg:flex-row lg:items-center gap-4">
        {/* Esquerda */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shrink-0"
            style={{
              background: 'linear-gradient(135deg, var(--brand-500), #10b981)',
              boxShadow: '0 8px 20px -8px rgba(16,185,129,0.55)'
            }}
          >
            <Users className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-black tracking-tight truncate" style={{ color: 'var(--text-1)' }}>
              Central de Contatos
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3, #94a3b8)' }}>
              {savedTotal != null && savedTotal > 0
                ? `${savedTotal.toLocaleString('pt-BR')} contatos na base`
                : stats.total > 0
                  ? `${stats.total.toLocaleString('pt-BR')} contatos na base`
                  : 'Importe contatos para comeÃ§ar'}
            </p>
          </div>
        </div>

        {/* Direita: aÃ§Ãµes */}
        <div className="flex items-center gap-2 flex-wrap lg:ml-auto">
          <button type="button" onClick={onOpenInsights} className="crm-btn">
            <BarChart3 className="w-4 h-4" style={{ color: 'var(--brand-500)' }} />
            <span className="hidden sm:inline">Insights</span>
          </button>

          <div className="relative" ref={importRef}>
            <button type="button" onClick={() => setImportOpen(v => !v)} className="crm-btn">
              <Upload className="w-4 h-4 text-emerald-500" />
              <span className="hidden sm:inline">Importar</span>
              <ChevronDown className="w-3 h-3 opacity-50" />
            </button>
            {importOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-72 rounded-2xl z-[100] overflow-hidden shadow-xl"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
              >
                <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ background: 'var(--surface-0)', color: 'var(--text-3, #94a3b8)', borderBottom: '1px solid var(--border)' }}>
                  OpÃ§Ãµes de importaÃ§Ã£o
                </div>
                {[
                  { icon: <FileSpreadsheet className="w-5 h-5 text-emerald-500" />, title: 'Importar XLSX / CSV', sub: 'Planilha com colunas do template', fn: () => { setImportOpen(false); onImportXLSX(); } },
                  { icon: <Smartphone className="w-5 h-5 text-teal-500" />, title: 'Importar vCard (.vcf)', sub: 'Exportado do celular (Contatos)', fn: () => { setImportOpen(false); onImportVcf(); } },
                  { icon: <Wand2 className="w-5 h-5 text-violet-500" />, title: 'ImportaÃ§Ã£o inteligente', sub: 'Cole texto livre â€” IA extrai os dados', fn: () => { setImportOpen(false); onSmartImport(); } },
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
            <button type="button" onClick={onOpenNormalizeNames} className="crm-btn" title="Padronizar nomes">
              <SpellCheck2 className="w-4 h-4 text-cyan-500" />
              <span className="hidden sm:inline">Limpar nomes</span>
            </button>
          )}

          {onOpenNormalizeAddresses && (
            <button type="button" onClick={onOpenNormalizeAddresses} disabled={addressNormalizeBusy} className="crm-btn disabled:opacity-50">
              <MapPin className={`w-4 h-4 text-rose-500 ${addressNormalizeBusy ? 'animate-pulse' : ''}`} />
              <span className="hidden sm:inline">{addressNormalizeBusy ? 'Padronizandoâ€¦' : 'Cidades'}</span>
            </button>
          )}

          <button type="button" onClick={onNewContact} className="crm-btn crm-btn-primary">
            <UserPlus className="w-4 h-4" />
            Novo contato
          </button>
        </div>
      </div>

      {/* â”€â”€ Linha 2: KPI tiles â”€â”€ */}
      {stats.total > 0 && (
        <div className="crm-kpi-row crm-fade-up">
          {kpis.map((k) => (
            <div key={k.label} className="crm-kpi-tile" style={{ borderTopColor: k.accent, borderTopWidth: 3 }}>
              <div className="crm-kpi-tile__eyebrow">
                <span style={{ color: k.accent }}>{k.icon}</span>
                {k.label}
              </div>
              <div className={`crm-kpi-tile__value ${k.pulse ? 'animate-pulse opacity-50' : ''}`} style={{ color: k.accent }}>{k.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* â”€â”€ Linha 3: barra de temperatura â”€â”€ */}
      {stats.total > 0 && (
        <div className="crm-temp-row crm-fade-up">
          <span className="text-[10px] font-bold uppercase tracking-widest shrink-0" style={{ color: 'var(--text-3, #94a3b8)' }}>
            Temperatura
          </span>
          <div className="crm-temp-bar">
            {contactTempsReady ? (
              <>
                {stats.hot > 0 && <div className="crm-temp-seg" style={{ width: `${(stats.hot / total) * 100}%`, background: '#ef4444' }} />}
                {stats.warm > 0 && <div className="crm-temp-seg" style={{ width: `${(stats.warm / total) * 100}%`, background: '#f59e0b' }} />}
                {stats.cold > 0 && <div className="crm-temp-seg" style={{ width: `${(stats.cold / total) * 100}%`, background: '#06b6d4' }} />}
              </>
            ) : (
              <div className="crm-temp-seg animate-pulse" style={{ width: '100%', background: 'var(--border)' }} />
            )}
          </div>
          <span className="text-[11px] font-semibold shrink-0" style={{ color: 'var(--text-2, #64748b)' }}>
            {contactTempsReady
              ? `ðŸ”¥ ${stats.hot} Â· ðŸŒ¡ï¸ ${stats.warm} Â· â„ï¸ ${stats.cold}`
              : 'calculandoâ€¦'}
          </span>
        </div>
      )}
    </div>
  );
});

ContactsCommandHero.displayName = 'ContactsCommandHero';

