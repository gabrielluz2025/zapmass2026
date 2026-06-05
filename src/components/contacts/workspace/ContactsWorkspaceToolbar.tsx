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
  retorno_semana: 'Retornos na semana'
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
  onRefreshTotals
}) => {
  const title = listName
    ? listName
    : activeFilter.startsWith('list:')
      ? 'Lista selecionada'
      : FILTER_LABELS[activeFilter] || 'Base de contatos';

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--surface-0)', border: '1px solid var(--border-subtle)' }}
    >
      <div
        className="h-1 w-full"
        style={{ background: 'linear-gradient(90deg, var(--brand-500), var(--brand-700))' }}
      />
      <div className="px-4 py-3.5 flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-black tracking-tight truncate" style={{ color: 'var(--text-1)' }}>
            {title}
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            {searchTerm.trim()
              ? `Busca: “${searchTerm.trim()}”`
              : listManageMode
                ? 'Adicione ou remova contatos desta lista. Troque para Todos para ver a base completa.'
                : 'Segmente, selecione e dispare campanhas com precisão.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <MiniStat icon={<Database className="w-3.5 h-3.5" />} label="Base" value={contactsSavedTotalLoading ? '…' : String(contactsSavedTotal ?? 0)} />
          <MiniStat icon={<Layers className="w-3.5 h-3.5" />} label="Carregados" value={String(contactsLoaded)} />
          <MiniStat icon={<Filter className="w-3.5 h-3.5" />} label="No filtro" value={String(filteredCount)} accent />
          <button
            type="button"
            onClick={onRefreshTotals}
            disabled={contactsSavedTotalLoading}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] font-bold transition disabled:opacity-50"
            style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
            title="Sincronizar total com o Firestore"
          >
            <RotateCw className={`w-3.5 h-3.5 ${contactsSavedTotalLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          {(contactsHasMore || contactsLoadingMore) && (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[10px] font-bold"
              style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.25)' }}
            >
              <Loader2 className="w-3 h-3 animate-spin" />
              Carregando mais…
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

const MiniStat: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}> = ({ icon, label, value, accent }) => (
  <div
    className="inline-flex items-center gap-2 px-2.5 py-2 rounded-lg tabular-nums"
    style={{
      background: accent ? 'rgba(59,130,246,0.08)' : 'var(--surface-1)',
      border: `1px solid ${accent ? 'rgba(59,130,246,0.2)' : 'var(--border-subtle)'}`
    }}
  >
    <span style={{ color: accent ? '#3b82f6' : 'var(--text-3)' }}>{icon}</span>
    <div className="text-left leading-tight">
      <div className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
        {label}
      </div>
      <div className="text-[13px] font-black" style={{ color: 'var(--text-1)' }}>
        {value}
      </div>
    </div>
  </div>
);
