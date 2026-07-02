import React from 'react';
import { Filter, RotateCw } from 'lucide-react';
import type { SmartFilterId } from './ContactsSidebar';

const FILTER_LABELS: Record<string, string> = {
  all: 'Todos os contatos',
  hot: 'Contatos quentes',
  warm: 'Contatos mornos',
  cold: 'Contatos frios',
  new: 'Sem histórico de envio',
  bday_today: 'Aniversariantes hoje',
  bday_week: 'Aniversários nos próximos 7 dias',
  wedding_today: 'Bodas hoje',
  wedding_week: 'Bodas nos próximos 7 dias',
  dormant: 'Contatos dormentes',
  invalid: 'Telefones inválidos',
  no_address: 'Sem endereço',
  duplicates: 'Possíveis duplicados',
  retorno_todos: 'Com retorno agendado',
  retorno_atrasados: 'Retornos atrasados',
  retorno_hoje: 'Retorno hoje',
  retorno_semana: 'Retornos na semana',
  no_list: 'Contatos sem lista'
};

type Props = {
  activeFilter: SmartFilterId;
  listName?: string;
  listManageMode?: boolean;
  searchTerm: string;
  contactsSavedTotal: number | null;
  contactsSavedTotalLoading: boolean;
  contactsLoaded: number;
  filteredCount: number;
  contactsHasMore: boolean;
  contactsLoadingMore: boolean;
  contactsLoadPaused?: boolean;
  onRefreshTotals: () => void;
};

export const ContactsWorkspaceToolbar: React.FC<Props> = ({
  activeFilter,
  listName,
  searchTerm,
  contactsSavedTotal,
  contactsSavedTotalLoading,
  filteredCount,
  onRefreshTotals
}) => {
  const title = listName
    ? listName
    : activeFilter.startsWith('list:')
      ? 'Lista selecionada'
      : FILTER_LABELS[activeFilter] || 'Base de contatos';

  const total = contactsSavedTotal ?? 0;

  return (
    <div className="crm-workspace-bar">
      <div className="min-w-0 flex-1">
        <span className="text-[13px] font-bold truncate" style={{ color: 'var(--crm-text)' }}>
          {title}
        </span>
        {searchTerm.trim() && (
          <span className="ml-2 text-[11px]" style={{ color: 'var(--crm-dim)' }}>
            — "{searchTerm.trim()}"
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 ml-auto">
        {/* Total na base */}
        {total > 0 && (
          <span className="crm-mini-stat tabular-nums">
            {total.toLocaleString('pt-BR')} contatos
          </span>
        )}

        {/* Filtrados (só mostra quando há filtro ativo) */}
        {(activeFilter !== 'all' || searchTerm.trim()) && (
          <span className="crm-mini-stat tabular-nums" style={{ borderColor: 'rgba(99,102,241,0.3)', color: 'var(--crm-brand)' }}>
            <Filter className="w-3 h-3" />
            {filteredCount.toLocaleString('pt-BR')}
          </span>
        )}

        {/* Botão de sincronizar total — sem spinner agressivo */}
        <button
          type="button"
          onClick={onRefreshTotals}
          disabled={contactsSavedTotalLoading}
          className="crm-mini-stat"
          style={{ cursor: contactsSavedTotalLoading ? 'default' : 'pointer', opacity: contactsSavedTotalLoading ? 0.5 : 1 }}
          title="Sincronizar total"
        >
          <RotateCw className={`w-3 h-3 ${contactsSavedTotalLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
};
