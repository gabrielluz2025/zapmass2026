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
      <div
        className="rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3"
        style={{ background: 'var(--crm-card)', border: '1px solid var(--crm-border)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ListIcon className="w-4 h-4 shrink-0" style={{ color: 'var(--crm-brand)' }} />
          <p className="text-[12.5px] font-medium" style={{ color: 'var(--crm-muted)' }}>
            Organize contatos em <strong style={{ color: 'var(--crm-text)' }}>listas</strong> para campanhas segmentadas.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateList}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white shrink-0 transition hover:brightness-110"
          style={{ background: 'var(--crm-brand)' }}
        >
          <Plus className="w-3.5 h-3.5" />
          Criar primeira lista
        </button>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl px-3 py-2.5"
      style={{ background: 'var(--crm-card)', border: '1px solid var(--crm-border)' }}
    >
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--crm-dim)' }}>
          Listas rápidas
        </span>
        <button
          type="button"
          onClick={onOpenListsTab}
          className="ml-auto text-[10px] font-bold inline-flex items-center gap-0.5 transition hover:underline"
          style={{ color: 'var(--crm-brand)' }}
        >
          Gerenciar
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar" style={{ scrollbarWidth: 'thin' }}>
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
          accent="orange"
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
          className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold border border-dashed transition"
          style={{ borderColor: 'var(--crm-brand)', color: 'var(--crm-brand)' }}
        >
          <Plus className="w-3 h-3" />
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
  accent?: 'brand' | 'orange';
}> = ({ label, count, active, onClick, accent = 'brand' }) => {
  const activeStyle =
    accent === 'orange'
      ? { background: 'rgba(249,115,22,0.12)', borderColor: 'rgba(249,115,22,0.5)', color: '#f97316' }
      : { background: 'var(--crm-brand-light)', borderColor: 'var(--crm-brand)', color: 'var(--crm-brand)' };

  const idleStyle = {
    background: 'var(--crm-bg)',
    borderColor: 'var(--crm-border)',
    color: 'var(--crm-muted)',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-semibold border transition"
      style={active ? { ...activeStyle, fontWeight: 700 } : idleStyle}
    >
      <span className="max-w-[140px] truncate">{label}</span>
      {count != null && count > 0 && (
        <span
          className="text-[10px] font-black px-1.5 py-0.5 rounded-md tabular-nums"
          style={{
            background: active ? 'rgba(0,0,0,0.1)' : 'var(--crm-border)',
            color: 'inherit',
          }}
        >
          {count.toLocaleString('pt-BR')}
        </span>
      )}
    </button>
  );
};
