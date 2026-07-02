import React from 'react';
import {
  UserPlus, Upload, Download, Wand2, FileSpreadsheet, Smartphone,
  ChevronDown, SpellCheck2, BarChart3, Users, Flame, Thermometer,
  Snowflake, Sparkles, Calendar
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
  savedTotal?: number | null;
  onNewContact: () => void;
  onImportXLSX: () => void;
  onImportVcf: () => void;
  onSmartImport: () => void;
  onDownloadTemplate: () => void;
  onExport: () => void;
  onOpenInsights: () => void;
  onOpenNormalizeNames?: () => void;
}

interface KpiTile {
  id: string;
  label: string;
  value: number;
  icon: React.ReactNode;
  accent: string;
  accentBg: string;
  show: boolean;
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

  const displayTotal = Math.max(stats.total, savedTotal ?? 0, 0);

  const kpis: KpiTile[] = [
    {
      id: 'total',
      label: 'Total',
      value: displayTotal,
      icon: <Users className="w-4 h-4" />,
      accent: '#10b981',
      accentBg: 'rgba(16,185,129,0.12)',
      show: true,
    },
    {
      id: 'hot',
      label: 'Quentes',
      value: stats.hot,
      icon: <Flame className="w-4 h-4" />,
      accent: '#ef4444',
      accentBg: 'rgba(239,68,68,0.1)',
      show: contactTempsReady,
    },
    {
      id: 'warm',
      label: 'Mornos',
      value: stats.warm,
      icon: <Thermometer className="w-4 h-4" />,
      accent: '#f59e0b',
      accentBg: 'rgba(245,158,11,0.1)',
      show: contactTempsReady,
    },
    {
      id: 'cold',
      label: 'Frios',
      value: stats.cold,
      icon: <Snowflake className="w-4 h-4" />,
      accent: '#06b6d4',
      accentBg: 'rgba(6,182,212,0.1)',
      show: contactTempsReady,
    },
    {
      id: 'new7',
      label: 'Novos (7d)',
      value: stats.last7,
      icon: <Sparkles className="w-4 h-4" />,
      accent: '#8b5cf6',
      accentBg: 'rgba(139,92,246,0.1)',
      show: true,
    },
    {
      id: 'bday',
      label: 'Aniv. hoje',
      value: stats.bdayToday,
      icon: <Calendar className="w-4 h-4" />,
      accent: '#f97316',
      accentBg: 'rgba(249,115,22,0.1)',
      show: stats.bdayToday > 0,
    },
  ];

  const visibleKpis = kpis.filter((k) => k.show);

  return (
    <div className="crm-fade-up flex flex-col gap-4">

      {/* ── KPI tiles ─────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${visibleKpis.length}, minmax(0, 1fr))`,
          gap: '0.75rem',
        }}
      >
        {visibleKpis.map((kpi) => (
          <div
            key={kpi.id}
            className="crm-kpi-tile"
            style={{ borderColor: `${kpi.accent}30` }}
          >
            <div className="crm-kpi-tile__eyebrow">
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  background: kpi.accentBg,
                  color: kpi.accent,
                  flexShrink: 0,
                }}
              >
                {kpi.icon}
              </span>
              {kpi.label}
            </div>
            <div
              className="crm-kpi-tile__value"
              style={{ color: kpi.accent }}
            >
              {kpi.value.toLocaleString('pt-BR')}
            </div>
          </div>
        ))}
      </div>

      {/* ── Barra de temperatura — só quando pronta ───── */}
      {stats.total > 0 && contactTempsReady && (stats.hot + stats.warm + stats.cold) > 0 && (
        <div className="crm-temp-row crm-fade-up">
          <span className="text-[10px] font-bold uppercase tracking-widest shrink-0" style={{ color: 'var(--text-3, #94a3b8)' }}>
            Engajamento
          </span>
          <div className="crm-temp-bar">
            {stats.hot > 0 && (
              <div className="crm-temp-seg" style={{ width: `${(stats.hot / displayTotal) * 100}%`, background: '#ef4444' }} />
            )}
            {stats.warm > 0 && (
              <div className="crm-temp-seg" style={{ width: `${(stats.warm / displayTotal) * 100}%`, background: '#f59e0b' }} />
            )}
            {stats.cold > 0 && (
              <div className="crm-temp-seg" style={{ width: `${(stats.cold / displayTotal) * 100}%`, background: '#06b6d4' }} />
            )}
          </div>
          <span className="text-[11px] font-mono font-semibold shrink-0 tabular-nums" style={{ color: 'var(--text-2, #64748b)' }}>
            {Math.round(((stats.hot + stats.warm + stats.cold) / Math.max(displayTotal, 1)) * 100)}% engajados
          </span>
        </div>
      )}

      {/* ── Barra de ações ────────────────────────────── */}
      <div className={`flex flex-col lg:flex-row lg:items-center lg:justify-end gap-2${importOpen ? ' relative z-[60]' : ''}`}>
        <div className="flex items-center gap-2 flex-wrap w-full lg:w-auto lg:ml-auto">
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
                  <button
                    key={item.title}
                    type="button"
                    onClick={item.fn}
                    className="w-full flex items-start gap-3 px-4 py-3 text-left transition"
                    style={{ borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-0)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {item.icon}
                    <div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{item.title}</div>
                      <div className="text-[11px]" style={{ color: 'var(--text-3, #94a3b8)' }}>{item.sub}</div>
                    </div>
                  </button>
                ))}
                <div className="p-2" style={{ background: 'var(--surface-0)' }}>
                  <button
                    type="button"
                    onClick={() => { setImportOpen(false); onDownloadTemplate(); }}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed text-xs font-bold transition"
                    style={{ borderColor: 'var(--crm-border-strong)', color: 'var(--text-2, #64748b)' }}
                  >
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
    </div>
  );
});

ContactsCommandHero.displayName = 'ContactsCommandHero';
