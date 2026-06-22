import React from 'react';
import { List as ListIcon, Plus, ChevronRight } from 'lucide-react';
import type { ContactList } from '../../../types';
import type { SmartFilterId } from './ContactsSidebar';

type Props = {
  lists: ContactList[];
  noListCount: number;
  activeFilter: SmartFilterId;
  onSelectFilter: (id: SmartFilterId) => void;
  onOpenListsTab: () => void;
  onCreateList: () => void;
};

export const ContactsListsRail: React.FC<Props> = ({
  lists,
  noListCount,
  activeFilter,
  onSelectFilter,
  onOpenListsTab,
  onCreateList
}) => {
  if (lists.length === 0) {
    return (
      <div className="crm-filter-panel p-3 zm-contacts-section flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ListIcon className="w-4 h-4 shrink-0 text-sky-400" />
          <p className="text-[12px] font-medium" style={{ color: 'var(--crm-muted)' }}>
            Organize contatos em <strong style={{ color: 'var(--crm-text)' }}>listas</strong> para campanhas segmentadas.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateList}
          className="zm-contacts-btn zm-contacts-btn-primary shrink-0 text-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          Criar primeira lista
        </button>
      </div>
    );
  }

  return (
    <div className="crm-filter-panel p-3 zm-contacts-section">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--crm-dim)' }}>
          Listas rÃ¡pidas
        </span>
        <button
          type="button"
          onClick={onOpenListsTab}
          className="ml-auto text-[10px] font-bold inline-flex items-center gap-0.5 hover:underline text-sky-400"
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
        <RailChip
          label="Sem lista"
          count={noListCount}
          active={activeFilter === 'no_list'}
          onClick={() => onSelectFilter('no_list')}
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
          className="crm-filter-panel p-3-chip border-dashed hover:border-sky-400/50"
          style={{ color: '#38bdf8' }}
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
    className={`crm-filter-panel p-3-chip${active ? ' is-active' : ''}`}
  >
    <ListIcon className="w-3 h-3 opacity-80" />
    <span className="max-w-[140px] truncate">{label}</span>
    {count != null && (
      <span
        className="text-[10px] font-black px-1.5 py-0.5 rounded-md tabular-nums"
        style={{ background: active ? 'rgba(255,255,255,0.2)' : 'rgba(15, 23, 42, 0.45)' }}
      >
        {count}
      </span>
    )}
  </button>
);

