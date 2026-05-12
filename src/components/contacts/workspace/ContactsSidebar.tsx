import React from 'react';
import {
  Users, Flame, Sparkles, Snowflake, Clock, Cake, Moon, AlertCircle,
  MapPinOff, Copy, List as ListIcon, Plus, MoreHorizontal, LucideIcon, Search, X, Trash2, CalendarClock, Heart
} from 'lucide-react';
import type { ContactList } from '../../../types';

/** Identificador do filtro ativo. 'list:<id>' para listas customizadas. */
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
  | `list:${string}`;

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
}

interface Props {
  active: SmartFilterId;
  onChange: (id: SmartFilterId) => void;
  counts: SidebarCounts;
  lists: ContactList[];
  onCreateList: (name: string) => void;
  onManageList: (listId: string) => void;
  /** Apaga a lista na base (não remove contatos do CRM). */
  onDeleteList: (listId: string, listName: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  /** Segmento religioso: bodas ficam só na ficha — não mostrar filtros rápidos de bodas. */
  hideWeddingFilters?: boolean;
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
  hideWeddingFilters = false
}) => {
  const [newListOpen, setNewListOpen] = React.useState(false);
  const [newListName, setNewListName] = React.useState('');

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
    { id: 'wedding_today', label: 'Bodas hoje', icon: Heart, tone: 'rose', count: counts.wedding_today, hint: 'Data de casamento na ficha' },
    { id: 'wedding_week', label: 'Bodas 7 dias', icon: Heart, tone: 'violet', count: counts.wedding_week, hint: 'Aniversário de casamento' },
    { id: 'dormant', label: 'Dormentes', icon: Moon, tone: 'slate', count: counts.dormant, hint: '>60 dias sem envio' },
    { id: 'invalid', label: 'Inválidos', icon: AlertCircle, tone: 'rose', count: counts.invalid },
    { id: 'no_address', label: 'Sem endereço', icon: MapPinOff, tone: 'orange', count: counts.no_address },
    { id: 'duplicates', label: 'Duplicados', icon: Copy, tone: 'rose', count: counts.duplicates }
  ];

  const groupAttention = hideWeddingFilters
    ? groupAttentionAll.filter((i) => i.id !== 'wedding_today' && i.id !== 'wedding_week')
    : groupAttentionAll;

  const groupRetornos: FilterItem[] = [
    {
      id: 'retorno_todos',
      label: 'Todos com retorno',
      icon: CalendarClock,
      tone: 'emerald',
      count: counts.retorno_todos,
      hint: 'Contatos com data de retorno agendada'
    },
    {
      id: 'retorno_atrasados',
      label: 'Atrasados',
      icon: AlertCircle,
      tone: 'rose',
      count: counts.retorno_atrasados,
      hint: 'Retorno antes de hoje'
    },
    {
      id: 'retorno_hoje',
      label: 'Hoje',
      icon: Clock,
      tone: 'amber',
      count: counts.retorno_hoje
    },
    {
      id: 'retorno_semana',
      label: 'Próximos 7 dias',
      icon: CalendarClock,
      tone: 'violet',
      count: counts.retorno_semana,
      hint: 'De hoje até +6 dias'
    }
  ];

  const handleCreate = () => {
    const name = newListName.trim();
    if (!name) return;
    onCreateList(name);
    setNewListName('');
    setNewListOpen(false);
  };

  return (
    <aside className="ui-card p-4 flex flex-col gap-5 h-full shadow-sm border-none bg-white dark:bg-slate-900/50 backdrop-blur-sm">
      {/* Busca */}
      <div className="relative group">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
          <Search className="w-4 h-4 text-slate-400 group-focus-within:text-[var(--brand-500)] transition-colors" />
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Buscar nome, número..."
          className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-100/50 dark:bg-slate-800/40 border border-transparent focus:bg-white dark:focus:bg-slate-800 border-slate-200/50 dark:border-slate-700/50 text-sm focus:outline-none focus:ring-4 focus:ring-[var(--brand-500)]/10 focus:border-[var(--brand-500)]/30 transition-all"
        />
        {query && (
          <button
            onClick={() => onQueryChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-all"
            title="Limpar"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pr-1 space-y-6 -mr-1 custom-scrollbar" style={{ scrollbarWidth: 'thin' }}>
        <Group title="Navegar">
          {groupSmart.map((item) => (
            <FilterButton
              key={item.id}
              item={item}
              active={active === item.id}
              onClick={() => onChange(item.id)}
            />
          ))}
        </Group>

        <Group title="Status & Saúde">
          {groupAttention.map((item) => (
            <FilterButton
              key={item.id}
              item={item}
              active={active === item.id}
              onClick={() => onChange(item.id)}
            />
          ))}
        </Group>

        <Group title="Agendamentos">
          {groupRetornos.map((item) => (
            <FilterButton
              key={item.id}
              item={item}
              active={active === item.id}
              onClick={() => onChange(item.id)}
            />
          ))}
        </Group>

        <Group
          title="Minhas listas"
          action={
            <button
              onClick={() => setNewListOpen((v) => !v)}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-[var(--brand-600)] transition-colors"
              title="Nova lista"
            >
              <Plus className="w-4 h-4" />
            </button>
          }
        >
          {newListOpen && (
            <div className="flex items-center gap-2 mb-3 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in-95 duration-200">
              <input
                type="text"
                autoFocus
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') { setNewListOpen(false); setNewListName(''); }
                }}
                placeholder="Nome da lista…"
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--brand-500)]/30"
              />
              <button
                onClick={handleCreate}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-white shadow-sm hover:brightness-110 active:scale-95 transition-all"
                style={{ background: 'var(--brand-600)' }}
              >
                Criar
              </button>
            </div>
          )}
          {lists.length === 0 && !newListOpen && (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
              <ListIcon className="w-8 h-8 text-slate-300 dark:text-slate-700 mb-2" />
              <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">Nenhuma lista criada</p>
            </div>
          )}
          <div className="space-y-1">
            {lists.map((list) => {
              const count = (list.contactIds || []).length;
              const listId = `list:${list.id}` as SmartFilterId;
              const isActive = active === listId;
              return (
                <div key={list.id} className="flex items-center group gap-1">
                  <button
                    onClick={() => onChange(listId)}
                    className={`flex-1 min-w-0 flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all ${
                      isActive
                        ? 'bg-[var(--brand-500)] text-white shadow-md shadow-[var(--brand-500)]/20'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <ListIcon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'opacity-60'}`} />
                    <span className="truncate text-xs font-bold flex-1">{list.name}</span>
                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${isActive ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                      {count}
                    </span>
                  </button>
                  <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onManageList(list.id); }}
                      className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-all"
                      title="Gerir lista"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteList(list.id, list.name);
                      }}
                      className="p-1.5 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 transition-all"
                      title="Apagar lista"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Group>
      </div>
    </aside>
  );
});
ContactsSidebar.displayName = 'ContactsSidebar';

const Group: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({ title, action, children }) => (
  <div>
    <div className="flex items-center justify-between px-2 mb-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</span>
      {action}
    </div>
    <div className="space-y-0.5">{children}</div>
  </div>
);

const toneClasses: Record<FilterItem['tone'], { active: string; icon: string }> = {
  slate: { active: 'bg-slate-200/70 dark:bg-slate-700/70 text-slate-900 dark:text-white', icon: 'text-slate-500' },
  rose: { active: 'bg-rose-500/15 text-rose-700 dark:text-rose-300', icon: 'text-rose-500' },
  amber: { active: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', icon: 'text-amber-500' },
  sky: { active: 'bg-sky-500/15 text-sky-700 dark:text-sky-300', icon: 'text-sky-500' },
  violet: { active: 'bg-violet-500/15 text-violet-700 dark:text-violet-300', icon: 'text-violet-500' },
  emerald: { active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', icon: 'text-emerald-500' },
  orange: { active: 'bg-orange-500/15 text-orange-700 dark:text-orange-300', icon: 'text-orange-500' }
};

const FilterButton: React.FC<{ item: FilterItem; active: boolean; onClick: () => void }> = ({ item, active, onClick }) => {
  const Icon = item.icon;
  const tone = toneClasses[item.tone];
  return (
    <button
      onClick={onClick}
      title={item.hint}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium transition ${
        active
          ? tone.active
          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
      }`}
    >
      <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? '' : tone.icon}`} />
      <span className="flex-1 text-left truncate">{item.label}</span>
      {item.count > 0 && (
        <span className={`text-[10px] font-bold ${active ? '' : 'text-slate-400 dark:text-slate-500'}`}>
          {item.count.toLocaleString('pt-BR')}
        </span>
      )}
    </button>
  );
};
