import React from 'react';
import { Database, Layers, Filter, RotateCw, Loader2 } from 'lucide-react';
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
  listManageMode = false,
  searchTerm,
  contactsSavedTotal,
  contactsSavedTotalLoading,
  contactsLoaded,
  filteredCount,
  contactsHasMore,
  contactsLoadingMore,
  contactsLoadPaused = false,
  onRefreshTotals
}) => {
  const title = listName
    ? listName
    : activeFilter.startsWith('list:')
      ? 'Lista selecionada'
      : FILTER_LABELS[activeFilter] || 'Base de contatos';

  return (
    <div className="crm-workspace-bar">
      <div className="min-w-0 flex-1">
        <span className="text-[13px] font-bold truncate" style={{ color: 'var(--crm-text)' }}>
          {title}
        </span>
        {searchTerm.trim() && (
          <span className="ml-2 text-[11px]" style={{ color: 'var(--crm-dim)' }}>
            — busca: "{searchTerm.trim()}"
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 ml-auto">
        <span className="crm-mini-stat">
          <Database className="w-3 h-3" style={{ color: 'var(--crm-dim)' }} />
          {contactsSavedTotalLoading ? '…' : (contactsSavedTotal ?? 0).toLocaleString('pt-BR')}
        </span>
        <span className="crm-mini-stat" style={{ borderColor: 'rgba(99,102,241,0.3)', color: 'var(--crm-brand)' }}>
          <Filter className="w-3 h-3" />
          {filteredCount.toLocaleString('pt-BR')}
        </span>
        <button
          type="button"
          onClick={onRefreshTotals}
          disabled={contactsSavedTotalLoading}
          className="crm-mini-stat"
          style={{ cursor: 'pointer' }}
          title="Sincronizar total"
        >
          <RotateCw className={`w-3 h-3 ${contactsSavedTotalLoading ? 'animate-spin' : ''}`} />
        </button>
        {(contactsLoadingMore || (contactsHasMore && contactsSavedTotal != null && contactsSavedTotal > contactsLoaded)) && (
          <span
            className="crm-mini-stat"
            style={{
              color: contactsLoadPaused ? '#f59e0b' : '#10b981',
              borderColor: contactsLoadPaused ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'
            }}
            title={
              contactsLoadPaused
                ? 'Carregamento pausado para manter a interface fluida — use Carregar mais na barra abaixo.'
                : undefined
            }
          >
            {contactsLoadingMore && <Loader2 className="w-3 h-3 animate-spin" />}
            {contactsSavedTotal != null && contactsSavedTotal > contactsLoaded
              ? `${contactsLoaded.toLocaleString('pt-BR')} / ${contactsSavedTotal.toLocaleString('pt-BR')}`
              : 'Carregando…'}
          </span>
        )}
      </div>
    </div>
  );
};
