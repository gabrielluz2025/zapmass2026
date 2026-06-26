import React from 'react';
import {
  Users, Flame, Sparkles, Snowflake, Clock, Cake, Moon, AlertCircle,
  MapPinOff, Copy, List as ListIcon, LucideIcon, Search, X, CalendarClock, Heart,
  LayoutGrid, SlidersHorizontal, ChevronDown, ChevronUp, ShieldOff
} from 'lucide-react';
import type { ContactList } from '../../../types';
import { ContactsListsPanel } from './ContactsListsPanel';

export type SmartFilterId =
  | 'all'
  | 'hot'
  | 'warm'
  | 'cold'
  | 'new'
  | 'bday_today'
  | 'bday_week'
  | 'wedding_today'
  | 'wedding_week'
  | 'dormant'
  | 'invalid'
  | 'no_address'
  | 'duplicates'
  | 'retorno_todos'
  | 'retorno_atrasados'
  | 'retorno_hoje'
  | 'retorno_semana'
  | 'no_list'
  | 'blacklist'
  | `list:${string}`;

export type SidebarPanelTab = 'explore' | 'lists' | 'advanced';

export interface SidebarCounts {
  all: number;
  hot: number;
  warm: number;
  cold: number;
  new: number;
  bday_today: number;
  bday_week: number;
  wedding_today: number;
  wedding_week: number;
  dormant: number;
  invalid: number;
  no_address: number;
  duplicates: number;
  retorno_todos: number;
  retorno_atrasados: number;
  retorno_hoje: number;
  retorno_semana: number;
  no_list: number;
  blacklist: number;
}

interface Props {
  active: SmartFilterId;
  onChange: (id: SmartFilterId) => void;
  counts: SidebarCounts;
  lists: ContactList[];
  onCreateList: (name: string) => void;
  onManageList: (listId: string) => void;
  onDeleteList: (listId: string, listName: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  hideWeddingFilters?: boolean;
  listsUiFocus?: 'none' | 'tab' | 'create';
  onListsUiFocusHandled?: () => void;
  /** false enquanto o cálculo de temperatura ainda não terminou */
  contactTempsReady?: boolean;
}

interface FilterItem {
  id: SmartFilterId;
  label: string;
  icon: LucideIcon;
  tone: 'slate' | 'rose' | 'amber' | 'sky' | 'violet' | 'emerald' | 'orange';
  count: number;
  hint?: string;
}

export const ContactsSidebar: React.FC<Props> = React.memo(({
  active,
  onChange,
  counts,
  lists,
  onCreateList,
  onManageList,
  onDeleteList,
  query,
  onQueryChange,
  hideWeddingFilters = false,
  listsUiFocus = 'none',
  onListsUiFocusHandled,
  contactTempsReady = true
}) => {
  const [panelTab, setPanelTab] = React.useState<SidebarPanelTab>('explore');
  const [openCreateSignal, setOpenCreateSignal] = React.useState(0);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  React.useEffect(() => {
    if (listsUiFocus === 'tab' || listsUiFocus === 'create') {
      setPanelTab('lists');
      if (listsUiFocus === 'create') setOpenCreateSignal((n) => n + 1);
      onListsUiFocusHandled?.();
    }
  }, [listsUiFocus, onListsUiFocusHandled]);

  React.useEffect(() => {
    if (active.startsWith('list:')) setPanelTab('lists');
  }, [active]);

  const activeListId = active.startsWith('list:') ? active.slice(5) : null;

  const groupSmart: FilterItem[] = [
    { id: 'all', label: 'Todos', icon: Users, tone: 'slate', count: counts.all },
    { id: 'hot', label: 'Quentes', icon: Flame, tone: 'rose', count: counts.hot, hint: 'Respondeu ou leu recentemente' },
    { id: 'warm', label: 'Mornos', icon: Sparkles, tone: 'amber', count: counts.warm, hint: 'Entregues mas sem resposta' },
    { id: 'cold', label: 'Frios', icon: Snowflake, tone: 'sky', count: counts.cold, hint: 'Sem interação recente' },
    { id: 'new', label: 'Sem histórico', icon: Clock, tone: 'slate', count: counts.new, hint: 'Nunca enviou nada' }
  ];

  const groupAttentionAll: FilterItem[] = [
    { id: 'bday_today', label: 'Aniver. hoje', icon: Cake, tone: 'amber', count: counts.bday_today },
    { id: 'bday_week', label: 'Aniver. 7 dias', icon: Cake, tone: 'violet', count: counts.bday_week },
    { id: 'wedding_today', label: 'Bodas hoje', icon: Heart, tone: 'rose', count: counts.wedding_today },
    { id: 'wedding_week', label: 'Bodas 7 dias', icon: Heart, tone: 'violet', count: counts.wedding_week },
    { id: 'dormant', label: 'Dormentes', icon: Moon, tone: 'slate', count: counts.dormant },
    { id: 'invalid', label: 'Inválidos', icon: AlertCircle, tone: 'rose', count: counts.invalid },
    { id: 'no_address', label: 'Sem endereço', icon: MapPinOff, tone: 'orange', count: counts.no_address },
    { id: 'duplicates', label: 'Duplicados', icon: Copy, tone: 'rose', count: counts.duplicates },
    { id: 'blacklist', label: 'Lista negra', icon: ShieldOff, tone: 'rose', count: counts.blacklist, hint: 'Optaram por não receber disparos' }
  ];

  const groupAttention = hideWeddingFilters
    ? groupAttentionAll.filter((i) => i.id !== 'wedding_today' && i.id !== 'wedding_week')
    : groupAttentionAll;

  const groupRetornos: FilterItem[] = [
    { id: 'retorno_todos', label: 'Com retorno', icon: CalendarClock, tone: 'emerald', count: counts.retorno_todos },
    { id: 'retorno_atrasados', label: 'Atrasados', icon: AlertCircle, tone: 'rose', count: counts.retorno_atrasados },
    { id: 'retorno_hoje', label: 'Hoje', icon: Clock, tone: 'amber', count: counts.retorno_hoje },
    { id: 'retorno_semana', label: 'Próximos 7 dias', icon: CalendarClock, tone: 'violet', count: counts.retorno_semana }
  ];

  const tabs: Array<{ id: SidebarPanelTab; label: string; icon: LucideIcon; badge?: number }> = [
    { id: 'explore', label: 'Explorar', icon: LayoutGrid },
    { id: 'lists', label: 'Listas', icon: ListIcon, badge: lists.length },
    { id: 'advanced', label: 'Filtros', icon: SlidersHorizontal }
  ];

  return (
    <aside
      className="rounded-2xl flex flex-col overflow-hidden lg:sticky lg:top-4 lg:self-start"
      style={{
        background: 'var(--crm-card)',
        border: '1px solid var(--crm-border)',
        minHeight: 'min(60vh, 560px)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
      }}
    >
      {/* Busca */}
      <div className="p-3 border-b" style={{ borderColor: 'var(--crm-border)' }}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--crm-dim)' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Buscar nome, número..."
            className="w-full pl-9 pr-8 py-2 rounded-xl text-sm outline-none"
            style={{
              background: 'var(--crm-bg)',
              border: '1px solid var(--crm-border)',
              color: 'var(--crm-text)',
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg"
              style={{ color: 'var(--crm-dim)' }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Abas */}
      <div className="flex border-b" style={{ borderColor: 'var(--crm-border)' }}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isOn = panelTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPanelTab(tab.id)}
              className="relative flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold transition"
              style={{
                color: isOn ? 'var(--crm-brand)' : 'var(--crm-dim)',
                borderBottom: isOn ? `2px solid var(--crm-brand)` : '2px solid transparent',
                background: 'transparent',
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.badge != null && tab.badge > 0 && (
                <span
                  className="absolute top-1 right-2 min-w-[14px] h-3.5 px-1 rounded-full text-[8px] font-black flex items-center justify-center"
                  style={{ background: 'var(--crm-brand)', color: '#fff' }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
        {panelTab === 'explore' && (
          <div className="space-y-1">
            {groupSmart.map((item) => {
              const isTempItem = item.id === 'hot' || item.id === 'warm' || item.id === 'cold' || item.id === 'new';
              return (
                <FilterRow
                  key={item.id}
                  item={item}
                  active={active === item.id}
                  onClick={() => onChange(item.id)}
                  loading={isTempItem && !contactTempsReady}
                />
              );
            })}

            <div className="pt-1">
              <button
                type="button"
                onClick={() => setAdvancedOpen(v => !v)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition"
                style={{ color: 'var(--crm-dim)' }}
              >
                <SlidersHorizontal className="w-3 h-3" />
                Filtros avançados
                {advancedOpen ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
              </button>

              {advancedOpen && (
                <div className="space-y-1 mt-1">
                  <div className="px-2 pt-1 pb-0.5 text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--crm-dim)' }}>
                    Status &amp; saúde
                  </div>
                  {groupAttention.map((item) => (
                    <FilterRow key={item.id} item={item} active={active === item.id} onClick={() => onChange(item.id)} />
                  ))}
                  <div className="px-2 pt-2 pb-0.5 text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--crm-dim)' }}>
                    Agendamentos
                  </div>
                  {groupRetornos.map((item) => (
                    <FilterRow key={item.id} item={item} active={active === item.id} onClick={() => onChange(item.id)} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {panelTab === 'lists' && (
          <ContactsListsPanel
            lists={lists}
            activeListId={activeListId}
            noListCount={counts.no_list}
            noListActive={active === 'no_list'}
            onSelectNoList={() => onChange('no_list')}
            onSelectList={(id) => onChange(`list:${id}`)}
            onShowAll={() => onChange('all')}
            onCreateList={onCreateList}
            onManageList={onManageList}
            onDeleteList={onDeleteList}
            openCreateSignal={openCreateSignal}
          />
        )}

        {panelTab === 'advanced' && (
          <div className="space-y-1">
            <div className="px-2 pt-1 pb-0.5 text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--crm-dim)' }}>
              Status &amp; saúde
            </div>
            {groupAttention.map((item) => (
              <FilterRow key={item.id} item={item} active={active === item.id} onClick={() => onChange(item.id)} />
            ))}
            <div className="px-2 pt-2 pb-0.5 text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--crm-dim)' }}>
              Agendamentos
            </div>
            {groupRetornos.map((item) => (
              <FilterRow key={item.id} item={item} active={active === item.id} onClick={() => onChange(item.id)} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
});
ContactsSidebar.displayName = 'ContactsSidebar';

const toneColors: Record<FilterItem['tone'], string> = {
  slate: '#64748b',
  rose: '#f43f5e',
  amber: '#f59e0b',
  sky: '#0ea5e9',
  violet: '#8b5cf6',
  emerald: '#10b981',
  orange: '#f97316'
};

const FilterRow: React.FC<{ item: FilterItem; active: boolean; onClick: () => void; loading?: boolean }> = ({
  item, active, onClick, loading = false
}) => {
  const Icon = item.icon;
  const color = toneColors[item.tone];
  return (
    <button
      type="button"
      onClick={onClick}
      title={item.hint}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm font-medium transition"
      style={{
        background: active ? `${color}12` : 'transparent',
        color: active ? color : 'var(--crm-muted)',
        fontWeight: active ? 700 : 500,
      }}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
      <span className="flex-1 text-left truncate text-[12.5px]">{item.label}</span>
      {loading ? (
        <span className="text-[10px] font-bold animate-pulse" style={{ color: 'var(--crm-dim)' }}>…</span>
      ) : item.count > 0 ? (
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
          style={{
            background: active ? `${color}20` : 'var(--crm-bg)',
            color: active ? color : 'var(--crm-dim)',
          }}
        >
          {item.count.toLocaleString('pt-BR')}
        </span>
      ) : null}
    </button>
  );
};
