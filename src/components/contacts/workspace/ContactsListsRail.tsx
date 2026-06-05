import React from 'react';
import { List as ListIcon, Plus, ChevronRight } from 'lucide-react';
import type { ContactList } from '../../../types';
import type { SmartFilterId } from './ContactsSidebar';

type Props = {
  lists: ContactList[];
  activeFilter: SmartFilterId;
  onSelectFilter: (id: SmartFilterId) => void;
  onOpenListsTab: () => void;
  onCreateList: () => void;
};

export const ContactsListsRail: React.FC<Props> = ({
  lists,
  activeFilter,
  onSelectFilter,
  onOpenListsTab,
  onCreateList
}) => {
  if (lists.length === 0) {
    return (
      <div
        className="rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ListIcon className="w-4 h-4 shrink-0" style={{ color: 'var(--brand-500)' }} />
          <p className="text-[12px] font-medium" style={{ color: 'var(--text-2)' }}>
            Organize contatos em <strong>listas</strong> para campanhas segmentadas.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateList}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white shrink-0"
          style={{ background: 'var(--brand-600)' }}
        >
          <Plus className="w-3.5 h-3.5" />
          Criar primeira lista
        </button>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
          Listas rápidas
        </span>
        <button
          type="button"
          onClick={onOpenListsTab}
          className="ml-auto text-[10px] font-bold inline-flex items-center gap-0.5 hover:underline"
          style={{ color: 'var(--brand-500)' }}
        >
          Gerenciar
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-0.5 custom-scrollbar" style={{ scrollbarWidth: 'thin' }}>
        <RailChip
          label="Todos"
          count={null}
          active={activeFilter === 'all'}
          onClick={() => onSelectFilter('all')}
        />
        {lists.map((list) => {
          const id = `list:${list.id}` as SmartFilterId;
          return (
            <RailChip
              key={list.id}
              label={list.name}
              count={(list.contactIds || []).length}
              active={activeFilter === id}
              onClick={() => onSelectFilter(id)}
            />
          );
        })}
        <button
          type="button"
          onClick={onCreateList}
          className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-full text-[11px] font-bold border border-dashed transition hover:bg-[var(--surface-2)]"
          style={{ borderColor: 'var(--brand-500)', color: 'var(--brand-500)' }}
        >
          <Plus className="w-3.5 h-3.5" />
          Nova
        </button>
      </div>
    </div>
  );
};

const RailChip: React.FC<{
  label: string;
  count: number | null;
  active: boolean;
  onClick: () => void;
}> = ({ label, count, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-full text-[11px] font-bold transition"
    style={
      active
        ? { background: 'var(--brand-600)', color: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }
        : { background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border-subtle)' }
    }
  >
    <ListIcon className="w-3 h-3 opacity-80" />
    <span className="max-w-[140px] truncate">{label}</span>
    {count != null && (
      <span
        className="text-[10px] font-black px-1.5 py-0.5 rounded-md tabular-nums"
        style={{ background: active ? 'rgba(255,255,255,0.2)' : 'var(--surface-0)' }}
      >
        {count}
      </span>
    )}
  </button>
);
