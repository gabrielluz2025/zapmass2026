import React from 'react';
import {
  Users, Flame, Sparkles, Snowflake, Clock, Cake, Moon, AlertCircle,
  MapPinOff, Copy, List as ListIcon, LucideIcon, Search, X, CalendarClock, Heart,
  LayoutGrid, SlidersHorizontal
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
  /** Abre aba Listas (vindo do rail superior). */
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
    { id: 'duplicates', label: 'Duplicados', icon: Copy, tone: 'rose', count: counts.duplicates }
  ];

  const groupAttention = hideWeddingFilters
    ? groupAttentionAll.filter((i) => i.id !== 'wedding_today' && i.id !== 'wedding_week')
    : groupAttentionAll;

  const groupRetornos: FilterItem[] = [
    { id: 'retorno_todos', label: 'Todos com retorno', icon: CalendarClock, tone: 'emerald', count: counts.retorno_todos },
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
    <aside className="zm-contacts-sidebar lg:sticky lg:top-4 lg:self-start p-3">
      <div className="pb-0">
        <div className="relative group">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <Search className="w-4 h-4" style={{ color: 'var(--zm-c-dim)' }} />
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Buscar nome, número..."
            className="zm-contacts-search"
          />
          {query && (
            <button
              onClick={() => onQueryChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg"
              style={{ color: 'var(--zm-c-dim)' }}
              title="Limpar"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div>
        <div
          className="grid grid-cols-3 gap-1 p-1 rounded-xl"
          style={{ background: 'rgba(15, 23, 42, 0.45)', border: '1px solid var(--zm-c-border)' }}
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isOn = panelTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setPanelTab(tab.id)}
                className={`zm-contacts-tab-btn relative${isOn ? ' is-active' : ''}`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.badge != null && tab.badge > 0 && (
                  <span
                    className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-black flex items-center justify-center"
                    style={{ background: isOn ? '#fff' : '#3b82f6', color: isOn ? '#1d4ed8' : '#fff' }}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pb-1 custom-scrollbar">
        {panelTab === 'explore' && (
          <div className="grid grid-cols-2 gap-2">
            {groupSmart.map((item) => {
              const isTempItem = item.id === 'hot' || item.id === 'warm' || item.id === 'cold' || item.id === 'new';
              return (
                <FilterCard
                  key={item.id}
                  item={item}
                  active={active === item.id}
                  onClick={() => onChange(item.id)}
                  loading={isTempItem && !contactTempsReady}
                />
              );
            })}
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
          <div className="space-y-4">
            <Group title="Status & saúde">
              {groupAttention.map((item) => (
                <FilterRow key={item.id} item={item} active={active === item.id} onClick={() => onChange(item.id)} />
              ))}
            </Group>
            <Group title="Agendamentos">
              {groupRetornos.map((item) => (
                <FilterRow key={item.id} item={item} active={active === item.id} onClick={() => onChange(item.id)} />
              ))}
            </Group>
          </div>
        )}
      </div>
    </aside>
  );
});
ContactsSidebar.displayName = 'ContactsSidebar';

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5 px-1" style={{ color: 'var(--zm-c-dim)' }}>
      {title}
    </p>
    <div className="space-y-0.5">{children}</div>
  </div>
);

const toneColors: Record<FilterItem['tone'], string> = {
  slate: '#64748b',
  rose: '#f43f5e',
  amber: '#f59e0b',
  sky: '#0ea5e9',
  violet: '#06B6D4',
  emerald: '#10b981',
  orange: '#f97316'
};

const FilterCard: React.FC<{ item: FilterItem; active: boolean; onClick: () => void; loading?: boolean }> = ({
  item,
  active,
  onClick,
  loading = false
}) => {
  const Icon = item.icon;
  const color = toneColors[item.tone];
  return (
    <button
      type="button"
      onClick={onClick}
      title={item.hint}
      className={`zm-contacts-filter-card${active ? ' is-active' : ''}`}
    >
      <Icon className="w-4 h-4" style={{ color }} />
      <span className="text-[11px] font-bold leading-tight" style={{ color: 'var(--zm-c-text)' }}>
        {item.label}
      </span>
      {loading ? (
        <span className="text-[10px] font-black tabular-nums animate-pulse" style={{ color: 'var(--zm-c-dim)' }}>…</span>
      ) : item.count > 0 ? (
        <span className="text-[10px] font-black tabular-nums" style={{ color: 'var(--zm-c-dim)' }}>
          {item.count.toLocaleString('pt-BR')}
        </span>
      ) : null}
    </button>
  );
};

const FilterRow: React.FC<{ item: FilterItem; active: boolean; onClick: () => void }> = ({
  item,
  active,
  onClick
}) => {
  const Icon = item.icon;
  const color = toneColors[item.tone];
  return (
    <button
      type="button"
      onClick={onClick}
      title={item.hint}
      className={`zm-contacts-filter-card flex-row items-center gap-2 py-2${active ? ' is-active' : ''}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
      <span className="flex-1 text-left truncate text-xs font-semibold" style={{ color: 'var(--zm-c-text)' }}>{item.label}</span>
      {item.count > 0 && (
        <span className="text-[10px] font-bold tabular-nums" style={{ color: 'var(--zm-c-dim)' }}>
          {item.count.toLocaleString('pt-BR')}
        </span>
      )}
    </button>
  );
};
