import React from 'react';
import {
  UserPlus, Upload, Download, Wand2, FileSpreadsheet, Smartphone,
  ChevronDown, SpellCheck2, BarChart3, Search, X,
  Users, Flame, Thermometer, Snowflake, Sparkles, Calendar
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
  searchTerm: string;
  onSearchChange: (q: string) => void;
  onNewContact: () => void;
  onImportXLSX: () => void;
  onImportVcf: () => void;
  onSmartImport: () => void;
  onDownloadTemplate: () => void;
  onExport: () => void;
  onOpenInsights: () => void;
  onOpenNormalizeNames?: () => void;
}

const KpiChip: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  bg: string;
  show?: boolean;
}> = ({ icon, label, value, color, bg, show = true }) => {
  if (!show) return null;
  return (
    <div
      className="ch-kpi-chip"
      style={{ '--chip-color': color, '--chip-bg': bg } as React.CSSProperties}
    >
      <span className="ch-kpi-chip__icon">{icon}</span>
      <span className="ch-kpi-chip__value">{value.toLocaleString('pt-BR')}</span>
      <span className="ch-kpi-chip__label">{label}</span>
    </div>
  );
};

export const ContactsCommandHero: React.FC<Props> = React.memo(({
  stats, contactTempsReady, savedTotal,
  searchTerm, onSearchChange,
  onNewContact, onImportXLSX, onImportVcf, onSmartImport,
  onDownloadTemplate, onExport, onOpenInsights, onOpenNormalizeNames
}) => {
  const [importOpen, setImportOpen] = React.useState(false);
  const importRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!importOpen) return;
    const close = (e: MouseEvent) => {
      if (importRef.current && !importRef.current.contains(e.target as Node)) setImportOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [importOpen]);

  const displayTotal = Math.max(stats.total, savedTotal ?? 0, 0);

  return (
    <div className="ch-hero crm-fade-up">

      {/* ── Linha 1: Busca + Ações primárias ─────── */}
      <div className="ch-hero__row1">
        {/* Search bar */}
        <div className="ch-search">
          <Search className="ch-search__icon" />
          <input
            ref={searchRef}
            type="search"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar nome, número, cidade, tag..."
            className="ch-search__input"
            autoComplete="off"
          />
          {searchTerm && (
            <button
              type="button"
              className="ch-search__clear"
              onClick={() => { onSearchChange(''); searchRef.current?.focus(); }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Action buttons */}
        <div className="ch-hero__actions">
          <button type="button" onClick={onOpenInsights} className="ch-btn" title="Insights">
            <BarChart3 className="w-4 h-4" style={{ color: 'var(--brand-500)' }} />
            <span className="hidden sm:inline">Insights</span>
          </button>

          {/* Import dropdown */}
          <div className="relative" ref={importRef}>
            <button
              type="button"
              onClick={() => setImportOpen((v) => !v)}
              className={`ch-btn${importOpen ? ' ch-btn--active' : ''}`}
              aria-expanded={importOpen}
            >
              <Upload className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">Importar</span>
              <ChevronDown className={`w-3 h-3 opacity-40 transition-transform${importOpen ? ' rotate-180' : ''}`} />
            </button>
            {importOpen && (
              <div
                className="absolute right-0 top-full mt-2 z-50 overflow-hidden"
                style={{
                  width: 280, borderRadius: 14,
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border)',
                  boxShadow: '0 20px 50px -10px rgba(0,0,0,0.55)',
                }}
              >
                <div style={{ padding: '8px 16px 6px', fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', borderBottom: '1px solid var(--border)', background: 'var(--surface-0)' }}>
                  Importar contatos
                </div>
                {[
                  { icon: <FileSpreadsheet className="w-4 h-4 text-emerald-400" />, title: 'XLSX / CSV', sub: 'Planilha com colunas do template', fn: () => { setImportOpen(false); onImportXLSX(); } },
                  { icon: <Smartphone className="w-4 h-4 text-teal-400" />, title: 'vCard (.vcf)', sub: 'Exportado do celular', fn: () => { setImportOpen(false); onImportVcf(); } },
                  { icon: <Wand2 className="w-4 h-4 text-violet-400" />, title: 'Importação inteligente', sub: 'Cole texto — IA organiza tudo', fn: () => { setImportOpen(false); onSmartImport(); } },
                ].map((item) => (
                  <button key={item.title} type="button" onClick={item.fn}
                    className="w-full flex items-start gap-3 px-4 py-3 text-left transition"
                    style={{ borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-0)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {item.icon}
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{item.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{item.sub}</div>
                    </div>
                  </button>
                ))}
                <div style={{ padding: 8, background: 'var(--surface-0)' }}>
                  <button type="button" onClick={() => { setImportOpen(false); onDownloadTemplate(); }}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-3)', fontSize: 11, fontWeight: 700 }}
                  >
                    <Download className="w-3 h-3" /> Baixar template XLSX
                  </button>
                </div>
              </div>
            )}
          </div>

          <button type="button" onClick={onExport} className="ch-btn">
            <Download className="w-4 h-4 text-sky-400" />
            <span className="hidden sm:inline">Exportar</span>
          </button>

          {onOpenNormalizeNames && (
            <button type="button" onClick={onOpenNormalizeNames} className="ch-btn" title="Padronizar nomes">
              <SpellCheck2 className="w-4 h-4 text-cyan-400" />
              <span className="hidden lg:inline">Limpar nomes</span>
            </button>
          )}

          <button type="button" onClick={onNewContact} className="ch-btn ch-btn--primary">
            <UserPlus className="w-4 h-4" />
            <span>Novo contato</span>
          </button>
        </div>
      </div>

      {/* ── Linha 2: KPI chips ───────────────────── */}
      <div className="ch-hero__kpis">
        <KpiChip icon={<Users className="w-3.5 h-3.5" />}     label="total"       value={displayTotal}  color="#10b981" bg="rgba(16,185,129,0.1)" />
        <KpiChip icon={<Flame className="w-3.5 h-3.5" />}     label="quentes"     value={stats.hot}     color="#f87171" bg="rgba(239,68,68,0.1)"   show={contactTempsReady} />
        <KpiChip icon={<Thermometer className="w-3.5 h-3.5" />} label="mornos"    value={stats.warm}    color="#fbbf24" bg="rgba(245,158,11,0.1)"  show={contactTempsReady} />
        <KpiChip icon={<Snowflake className="w-3.5 h-3.5" />} label="frios"       value={stats.cold}    color="#22d3ee" bg="rgba(6,182,212,0.1)"   show={contactTempsReady} />
        <KpiChip icon={<Sparkles className="w-3.5 h-3.5" />}  label="novos 7d"    value={stats.last7}   color="#a78bfa" bg="rgba(139,92,246,0.1)" />
        <KpiChip icon={<Calendar className="w-3.5 h-3.5" />}  label="aniv. hoje"  value={stats.bdayToday} color="#fb923c" bg="rgba(249,115,22,0.1)" show={stats.bdayToday > 0} />

        {/* Barra de engajamento — só quando pronto */}
        {contactTempsReady && (stats.hot + stats.warm + stats.cold) > 0 && (
          <div className="ch-engage-bar">
            <div className="ch-engage-bar__track">
              {stats.hot  > 0 && <div style={{ width: `${(stats.hot  / Math.max(displayTotal, 1)) * 100}%`, background: '#ef4444' }} />}
              {stats.warm > 0 && <div style={{ width: `${(stats.warm / Math.max(displayTotal, 1)) * 100}%`, background: '#f59e0b' }} />}
              {stats.cold > 0 && <div style={{ width: `${(stats.cold / Math.max(displayTotal, 1)) * 100}%`, background: '#06b6d4' }} />}
            </div>
            <span className="ch-engage-bar__label">
              {Math.round(((stats.hot + stats.warm + stats.cold) / Math.max(displayTotal, 1)) * 100)}% engajados
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

ContactsCommandHero.displayName = 'ContactsCommandHero';
