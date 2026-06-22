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
    <div className="zm-contacts-header zm-contacts-section flex flex-col lg:flex-row gap-5 lg:items-center lg:justify-between relative overflow-visible">
      {/* Esquerda — identidade + mini stats */}
      <div className="flex items-center gap-4 min-w-0 relative z-10">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center text-white shrink-0 shadow-lg"
          style={{ background: 'linear-gradient(135deg, #06b6d4, #10b981)' }}
        >
          <Users className="w-6 h-6" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-black tracking-tight" style={{ color: 'var(--zm-c-text)' }}>Contatos</h1>
            <div
              className="px-2.5 py-1 rounded-lg text-xs font-black shadow-sm"
              style={{ background: 'rgba(59, 130, 246, 0.2)', color: 'var(--zm-c-text)', border: '1px solid rgba(59, 130, 246, 0.35)' }}
              title="Total de contatos na base"
            >
              {stats.total.toLocaleString('pt-BR')}
            </div>
          </div>
          <div className="text-xs flex items-center gap-x-4 gap-y-2 flex-wrap mt-1.5" style={{ color: 'var(--zm-c-muted)' }}>
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
          className="zm-contacts-btn"
          title="Ver painel completo de análise (carrega sob demanda)"
        >
          <BarChart3 className="w-4 h-4 text-sky-400" />
          <span className="hidden sm:inline">Insights</span>
        </button>

        <div className="relative" ref={importBtnRef}>
          <button
            onClick={() => setImportOpen((v) => !v)}
            className="zm-contacts-btn"
          >
            <Upload className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline">Importar</span>
            <ChevronDown className="w-3.5 h-3.5 opacity-60" />
          </button>
          {importOpen && (
            <div
              className="absolute right-0 top-full mt-2 w-72 rounded-2xl shadow-2xl z-[100] overflow-hidden ring-4 ring-black/5"
              style={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid var(--zm-c-border)', backdropFilter: 'blur(16px)' }}
            >
              <div
                className="px-4 py-2.5 border-b text-[10px] font-bold uppercase tracking-wider"
                style={{ background: 'rgba(30, 41, 59, 0.55)', borderColor: 'var(--zm-c-border)', color: 'var(--zm-c-dim)' }}
              >
                Opções de entrada
              </div>
              <MenuItem
                icon={<FileSpreadsheet className="w-5 h-5 text-emerald-400" />}
                title="Importar XLSX / CSV"
                subtitle="Planilha com as colunas do template"
                onClick={() => { setImportOpen(false); onImportXLSX(); }}
              />
              <MenuItem
                icon={<Smartphone className="w-5 h-5 text-teal-400" />}
                title="Importar vCard (.vcf)"
                subtitle="Exportado do celular (Contatos)"
                onClick={() => { setImportOpen(false); onImportVcf(); }}
              />
              <MenuItem
                icon={<Wand2 className="w-5 h-5 text-cyan-400" />}
                title="Importação inteligente"
                subtitle="Cole texto livre — a IA extrai os dados"
                onClick={() => { setImportOpen(false); onSmartImport(); }}
              />
              <div className="p-2" style={{ background: 'rgba(30, 41, 59, 0.35)' }}>
                <button
                  onClick={() => { setImportOpen(false); onDownloadTemplate(); }}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed text-xs font-bold transition hover:opacity-90"
                  style={{ borderColor: 'var(--zm-c-border)', color: 'var(--zm-c-muted)' }}
                >
                  <Download className="w-3.5 h-3.5" />
                  Baixar template XLSX
                </button>
              </div>
            </div>
          )}
        </div>

        <button onClick={onExport} className="zm-contacts-btn">
          <Download className="w-4 h-4 text-sky-400" />
          <span className="hidden sm:inline">Exportar</span>
        </button>

        {onOpenNormalizeNames && (
          <button
            type="button"
            onClick={onOpenNormalizeNames}
            className="zm-contacts-btn"
            title="Remover prefixos, padronizar maiúsculas e opcionalmente reduzir a primeiro e último nome"
          >
            <SpellCheck2 className="w-4 h-4 text-cyan-400" />
            <span className="hidden sm:inline">Limpar nomes</span>
          </button>
        )}

        {onOpenNormalizeAddresses && (
          <button
            type="button"
            onClick={onOpenNormalizeAddresses}
            disabled={addressNormalizeBusy}
            className="zm-contacts-btn disabled:opacity-60"
            title='Unifica "BLUMENAU - SC" → Blumenau + SC; corrige maiúsculas e UF pelo DDD'
          >
            <MapPin className={`w-4 h-4 text-rose-400 ${addressNormalizeBusy ? 'animate-pulse' : ''}`} />
            <span className="hidden sm:inline">{addressNormalizeBusy ? 'Padronizando…' : 'Padronizar cidades'}</span>
          </button>
        )}

        <button onClick={onNewContact} className="zm-contacts-btn zm-contacts-btn-primary">
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
    emerald: '#34d399',
    sky: '#38bdf8',
    rose: '#fb7185',
    amber: '#fbbf24'
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 ${pulse ? 'animate-pulse' : ''}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${pulse ? 'bg-amber-500' : ''}`} style={pulse ? undefined : { background: 'var(--zm-c-dim)' }} />
      <span className="font-semibold" style={{ color: toneMap[tone] }}>{value.toLocaleString('pt-BR')}</span>
      <span style={{ color: 'var(--zm-c-muted)' }}>{label}</span>
    </span>
  );
};

const PillLoading: React.FC<{ label: string; tone: 'emerald' | 'sky' | 'rose' | 'amber' }> = ({ label, tone }) => {
  const toneMap: Record<typeof tone, string> = {
    emerald: '#34d399',
    sky: '#38bdf8',
    rose: '#fb7185',
    amber: '#fbbf24'
  } as const;
  return (
    <span className="inline-flex items-center gap-1 animate-pulse">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--zm-c-dim)' }} />
      <span className="font-semibold" style={{ color: toneMap[tone] }}>…</span>
      <span style={{ color: 'var(--zm-c-muted)' }}>{label}</span>
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
    className="w-full flex items-start gap-3 px-3 py-2.5 transition text-left hover:bg-white/5"
  >
    <div className="mt-0.5">{icon}</div>
    <div>
      <div className="text-sm font-semibold" style={{ color: 'var(--zm-c-text)' }}>{title}</div>
      <div className="text-[11px]" style={{ color: 'var(--zm-c-muted)' }}>{subtitle}</div>
    </div>
  </button>
);
