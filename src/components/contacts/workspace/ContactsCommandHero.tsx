import React from 'react';
import {
  UserPlus, Upload, Download, Wand2, FileSpreadsheet, Smartphone,
  ChevronDown, SpellCheck2, BarChart3, Search, X, Database,
  Users, Flame, Thermometer, Snowflake, Sparkles, Calendar, Heart, MoreHorizontal,
} from 'lucide-react';
import type { SmartFilterId } from './contactsFilters';
import { ZmFieldHelp, ZmPageHeader } from '../../ui';
import { FIELD_HELP } from '../../../constants/fieldHelpCopy';

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
  onSelectFilter?: (id: SmartFilterId) => void;
  onNewContact: () => void;
  onImportXLSX: () => void;
  onImportVcf: () => void;
  onSmartImport: () => void;
  onDownloadTemplate: () => void;
  onExport: () => void;
  onOpenInsights: () => void;
  onOpenNormalizeNames?: () => void;
  onSyncWaNames?: () => void;
  onOpenFixBase?: () => void;
  onSaveBaseToChip?: () => void;
}

const KpiChip: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  bg: string;
  show?: boolean;
  onClick?: () => void;
}> = ({ icon, label, value, color, bg, show = true, onClick }) => {
  if (!show) return null;
  const style = { '--chip-color': color, '--chip-bg': bg } as React.CSSProperties;
  const body = (
    <>
      <span className="ch-kpi-chip__icon">{icon}</span>
      <span className="ch-kpi-chip__value">{value.toLocaleString('pt-BR')}</span>
      <span className="ch-kpi-chip__label">{label}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="ch-kpi-chip ch-kpi-chip--clickable" style={style} onClick={onClick}>
        {body}
      </button>
    );
  }
  return (
    <div className="ch-kpi-chip" style={style}>
      {body}
    </div>
  );
};

type MenuItem = {
  icon: React.ReactNode;
  title: string;
  sub: string;
  fn: () => void;
  show?: boolean;
};

export const ContactsCommandHero: React.FC<Props> = React.memo(({
  stats, contactTempsReady, hideWedding, savedTotal,
  searchTerm, onSearchChange, onSelectFilter,
  onNewContact, onImportXLSX, onImportVcf, onSmartImport,
  onDownloadTemplate, onExport, onOpenInsights, onOpenNormalizeNames, onSyncWaNames, onOpenFixBase, onSaveBaseToChip
}) => {
  const [importOpen, setImportOpen] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const importRef = React.useRef<HTMLDivElement>(null);
  const moreRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!importOpen && !moreOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (importOpen && importRef.current && !importRef.current.contains(t)) setImportOpen(false);
      if (moreOpen && moreRef.current && !moreRef.current.contains(t)) setMoreOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [importOpen, moreOpen]);

  const displayTotal = Math.max(stats.total, savedTotal ?? 0, 0);
  const pick = (id: SmartFilterId) => (onSelectFilter ? () => onSelectFilter(id) : undefined);

  const moreItems: MenuItem[] = [
    {
      icon: <BarChart3 className="w-4 h-4" style={{ color: 'var(--brand-500)' }} />,
      title: 'Insights da base',
      sub: 'Segmentos, mapas e métricas',
      fn: () => { setMoreOpen(false); onOpenInsights(); },
      show: true,
    },
    {
      icon: <Download className="w-4 h-4 text-sky-400" />,
      title: 'Exportar contatos',
      sub: 'Baixar planilha ou vCard da visão atual',
      fn: () => { setMoreOpen(false); onExport(); },
      show: true,
    },
    {
      icon: <Database className="w-4 h-4 text-amber-400" />,
      title: 'Corrigir telefones e endereços',
      sub: 'Varredura segura na base inteira',
      fn: () => { setMoreOpen(false); onOpenFixBase?.(); },
      show: Boolean(onOpenFixBase),
    },
    {
      icon: <Smartphone className="w-4 h-4 text-violet-400" />,
      title: 'Sincronizar agenda do WhatsApp',
      sub: 'Gravar contatos no celular do chip',
      fn: () => { setMoreOpen(false); onSaveBaseToChip?.(); },
      show: Boolean(onSaveBaseToChip),
    },
    {
      icon: <Smartphone className="w-4 h-4 text-emerald-400" />,
      title: 'Buscar nomes no perfil WhatsApp',
      sub: 'Para contatos com nome genérico',
      fn: () => { setMoreOpen(false); onSyncWaNames?.(); },
      show: Boolean(onSyncWaNames),
    },
    {
      icon: <SpellCheck2 className="w-4 h-4 text-cyan-400" />,
      title: 'Padronizar nomes da base',
      sub: 'Capitalização e prefixos',
      fn: () => { setMoreOpen(false); onOpenNormalizeNames?.(); },
      show: Boolean(onOpenNormalizeNames),
    },
  ].filter((i) => i.show !== false);

  const dropdownPanel = (title: string, children: React.ReactNode) => (
    <div
      className="ch-dropdown-panel absolute right-0 top-full mt-2 z-50 overflow-hidden"
      style={{
        width: 300,
        borderRadius: 14,
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: '0 20px 50px -10px rgba(0,0,0,0.55)',
      }}
    >
      <div className="ch-dropdown-panel__head">{title}</div>
      {children}
    </div>
  );

  return (
    <div className="space-y-4 crm-fade-up">
      <ZmPageHeader
        icon={<Users className="w-5 h-5 text-cyan-400" />}
        title="Base de contatos"
        subtitle={`${displayTotal.toLocaleString('pt-BR')} na visão atual · importe planilhas, busque e filtre por temperatura.`}
      />

    <div className="ch-hero zm-glass-card-v2 zm-glass-card-v2--pad-md">

      <div className="ch-hero__row1">
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

        <div className="ch-hero__actions-wrap">
          <div className="ch-hero__actions-label">
            <span>Ações principais</span>
            <ZmFieldHelp content={FIELD_HELP.contactsToolbar} ariaLabel="Ajuda: ações da base de contatos" />
          </div>
          <div className="ch-hero__actions">
            <div className="ch-btn-with-help">
              <button
                type="button"
                onClick={onDownloadTemplate}
                className="ch-btn ch-btn--template"
                title="Planilha modelo para importação"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                <span className="hidden sm:inline">Baixar modelo (.xlsx)</span>
                <span className="sm:hidden">Modelo</span>
              </button>
              <ZmFieldHelp content={FIELD_HELP.contactsImportTemplate} ariaLabel="Ajuda: modelo de planilha" />
            </div>

            <div className="relative" ref={importRef}>
              <button
                type="button"
                onClick={() => { setMoreOpen(false); setImportOpen((v) => !v); }}
                className={`ch-btn ch-btn--import${importOpen ? ' ch-btn--active' : ''}`}
                aria-expanded={importOpen}
              >
                <Upload className="w-4 h-4 text-emerald-400" />
                <span className="hidden sm:inline">Importar planilha</span>
                <span className="sm:hidden">Importar</span>
                <ChevronDown className={`w-3 h-3 opacity-40 transition-transform${importOpen ? ' rotate-180' : ''}`} />
              </button>
              {importOpen && dropdownPanel('Como você quer importar?', (
                <>
                  {[
                    { icon: <FileSpreadsheet className="w-4 h-4 text-emerald-400" />, title: 'Excel ou CSV', sub: 'Use o modelo ou suas colunas Nome + Telefone', fn: () => { setImportOpen(false); onImportXLSX(); } },
                    { icon: <Smartphone className="w-4 h-4 text-teal-400" />, title: 'Cartão de visita (.vcf)', sub: 'Exportado do celular', fn: () => { setImportOpen(false); onImportVcf(); } },
                    { icon: <Wand2 className="w-4 h-4 text-violet-400" />, title: 'Colar lista (IA)', sub: 'Cole texto — a IA organiza as linhas', fn: () => { setImportOpen(false); onSmartImport(); } },
                  ].map((item) => (
                    <button key={item.title} type="button" onClick={item.fn} className="ch-dropdown-panel__item">
                      {item.icon}
                      <div>
                        <div className="ch-dropdown-panel__item-title">{item.title}</div>
                        <div className="ch-dropdown-panel__item-sub">{item.sub}</div>
                      </div>
                    </button>
                  ))}
                </>
              ))}
            </div>

            <button type="button" onClick={onNewContact} className="ch-btn ch-btn--primary">
              <UserPlus className="w-4 h-4" />
              <span>Novo contato</span>
            </button>

            <div className="relative" ref={moreRef}>
              <button
                type="button"
                onClick={() => { setImportOpen(false); setMoreOpen((v) => !v); }}
                className={`ch-btn ch-btn--more${moreOpen ? ' ch-btn--active' : ''}`}
                aria-expanded={moreOpen}
              >
                <MoreHorizontal className="w-4 h-4" />
                <span className="hidden sm:inline">Mais ações</span>
                <ChevronDown className={`w-3 h-3 opacity-40 transition-transform${moreOpen ? ' rotate-180' : ''}`} />
              </button>
              {moreOpen && dropdownPanel('Ferramentas avançadas', (
                <>
                  {moreItems.map((item) => (
                    <button key={item.title} type="button" onClick={item.fn} className="ch-dropdown-panel__item">
                      {item.icon}
                      <div>
                        <div className="ch-dropdown-panel__item-title">{item.title}</div>
                        <div className="ch-dropdown-panel__item-sub">{item.sub}</div>
                      </div>
                    </button>
                  ))}
                </>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="ch-hero__kpis">
        <KpiChip icon={<Users className="w-3.5 h-3.5" />} label="total" value={displayTotal} color="#10b981" bg="rgba(16,185,129,0.1)" onClick={pick('all')} />
        <KpiChip icon={<Flame className="w-3.5 h-3.5" />} label="quentes" value={stats.hot} color="#f87171" bg="rgba(239,68,68,0.1)" onClick={pick('hot')} />
        <KpiChip icon={<Thermometer className="w-3.5 h-3.5" />} label="mornos" value={stats.warm} color="#fbbf24" bg="rgba(245,158,11,0.1)" onClick={pick('warm')} />
        <KpiChip icon={<Snowflake className="w-3.5 h-3.5" />} label="frios" value={stats.cold} color="#22d3ee" bg="rgba(6,182,212,0.1)" onClick={pick('cold')} />
        <KpiChip icon={<Sparkles className="w-3.5 h-3.5" />} label="novos 7d" value={stats.last7} color="#a78bfa" bg="rgba(139,92,246,0.1)" onClick={pick('new')} />
        <KpiChip icon={<Calendar className="w-3.5 h-3.5" />} label="aniv. hoje" value={stats.bdayToday} color="#fb923c" bg="rgba(249,115,22,0.1)" show={stats.bdayToday > 0} onClick={pick('bday_today')} />
        <KpiChip
          icon={<Heart className="w-3.5 h-3.5" />}
          label="bodas 7d"
          value={stats.weddingWeek}
          color="#f472b6"
          bg="rgba(244,114,182,0.1)"
          show={!hideWedding && stats.weddingWeek > 0}
          onClick={pick('wedding_week')}
        />

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
    </div>
  );
});

ContactsCommandHero.displayName = 'ContactsCommandHero';
